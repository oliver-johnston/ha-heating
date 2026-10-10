from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import ControlledTRV, HeatingConfig, TRVEntities
from .ha_client import RegistrySnapshot

ROLE_RULES: dict[str, tuple[set[str], tuple[str, ...]]] = {
    "external_temperature_input": ({"number"}, ("external_temperature_input",)),
    "frost_protection_temperature": ({"number"}, ("frost_protection_temperature",)),
    "local_temperature_calibration": ({"number"}, ("local_temperature_calibration",)),
    "temperature_accuracy": ({"number"}, ("temperature_accuracy",)),
    "temporary_mode_duration": ({"number"}, ("temporary_mode_duration",)),
    "timer_mode_target_temperature": ({"number"}, ("timer_mode_target_temp",)),
    "local_temperature": ({"sensor"}, ("local_temperature",)),
    "battery": ({"sensor"}, ("battery",)),
    "last_seen": ({"sensor"}, ("last_seen",)),
    "child_lock": ({"switch"}, ("child_lock",)),
    "smart_temperature_control": ({"switch"}, ("smart_temperature_control",)),
    "open_window": ({"switch"}, ("open_window",)),
    "temperature_sensor_select": ({"select"}, ("temperature_sensor_select",)),
    "temporary_mode_select": ({"select"}, ("temporary_mode_select",)),
    "valve_opening_degree": ({"number"}, ("valve_opening_degree",)),
    "valve_closing_degree": ({"number"}, ("valve_closing_degree",)),
    "closing_steps": ({"sensor"}, ("closing_steps",)),
    "idle_steps": ({"sensor"}, ("idle_steps",)),
    "valve_opening_limit_voltage": ({"sensor"}, ("valve_opening_limit_voltage",)),
    "valve_closing_limit_voltage": ({"sensor"}, ("valve_closing_limit_voltage",)),
    "valve_motor_running_voltage": ({"sensor"}, ("valve_motor_running_voltage",)),
    "linkquality": ({"sensor"}, ("linkquality",)),
    "firmware_update": ({"update"}, ("",)),
}


def _domain(entity_id: str) -> str:
    return entity_id.partition(".")[0]


def _normalise(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")


def _display_name(device: dict[str, Any]) -> str:
    return str(device.get("name_by_user") or device.get("name") or "SONOFF TRV")


def _suggest_group(name: str) -> str:
    cleaned = re.sub(r"\b(sonoff|thermostatic|radiator|valve|trvzb|trv)\b", "", name, flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -_")
    return cleaned or name


def _is_sonoff_trv(device: dict[str, Any], device_entities: list[dict[str, Any]]) -> bool:
    manufacturer = _normalise(device.get("manufacturer"))
    model = _normalise(device.get("model"))
    via_name = _normalise(_display_name(device))
    has_climate = any(
        _domain(entity.get("entity_id", "")) == "climate" for entity in device_entities
    )
    identified = "sonoff" in manufacturer or "trvzb" in model or "trvzb" in via_name
    return has_climate and identified


def _pick_role(
    entities: Iterable[dict[str, Any]], domains: set[str], suffixes: tuple[str, ...]
) -> str | None:
    candidates: list[tuple[int, str]] = []
    for entity in entities:
        entity_id = str(entity.get("entity_id", ""))
        if _domain(entity_id) not in domains:
            continue
        object_id = entity_id.partition(".")[2]
        original = _normalise(entity.get("original_name"))
        score = 0
        for suffix in suffixes:
            if object_id.endswith(suffix):
                score = max(score, 100)
            elif suffix in object_id:
                score = max(score, 80)
            if original == suffix:
                score = max(score, 70)
            elif suffix in original:
                score = max(score, 60)
        if score:
            candidates.append((score, entity_id))
    if not candidates:
        return None
    return sorted(candidates, key=lambda item: (-item[0], item[1]))[0][1]


def _map_entities(device_entities: list[dict[str, Any]]) -> TRVEntities | None:
    climate = sorted(
        entity["entity_id"]
        for entity in device_entities
        if _domain(str(entity.get("entity_id", ""))) == "climate"
        and entity.get("disabled_by") is None
    )
    if not climate:
        return None
    mapped: dict[str, str | None] = {"climate": climate[0]}
    for role, (domains, suffixes) in ROLE_RULES.items():
        mapped[role] = _pick_role(device_entities, domains, suffixes)
    return TRVEntities.model_validate(mapped)


def discover(snapshot: RegistrySnapshot) -> dict[str, Any]:
    areas = {area["area_id"]: area.get("name") for area in snapshot.areas}
    devices = {device["id"]: device for device in snapshot.devices if device.get("id")}
    states = {state["entity_id"]: state for state in snapshot.states}
    entities_by_device: dict[str, list[dict[str, Any]]] = {}
    for entity in snapshot.entities:
        device_id = entity.get("device_id")
        if device_id:
            entities_by_device.setdefault(device_id, []).append(entity)

    trvs: list[dict[str, Any]] = []
    for device in snapshot.devices:
        device_id = device.get("id")
        device_entities = entities_by_device.get(device_id, [])
        if not device_id or not _is_sonoff_trv(device, device_entities):
            continue
        mapped = _map_entities(device_entities)
        if mapped is None:
            continue
        name = _display_name(device)
        missing_recommended = [
            role
            for role in (
                "external_temperature_input",
                "battery",
                "last_seen",
                "child_lock",
                "smart_temperature_control",
            )
            if getattr(mapped, role) is None
        ]
        trvs.append(
            {
                "device_id": device_id,
                "name": name,
                "manufacturer": device.get("manufacturer"),
                "model": device.get("model"),
                "software_version": device.get("sw_version"),
                "area_name": areas.get(device.get("area_id")),
                "suggested_group": _suggest_group(name),
                "suggested_temperature_sensor": None,
                "entities": mapped.model_dump(),
                "missing_recommended": missing_recommended,
            }
        )

    temperature_sensors: list[dict[str, Any]] = []
    switches: list[dict[str, Any]] = []
    for entity in snapshot.entities:
        if entity.get("disabled_by") is not None:
            continue
        entity_id = str(entity.get("entity_id", ""))
        state = states.get(entity_id, {})
        attributes = state.get("attributes", {})
        area_id = entity.get("area_id")
        device = devices.get(entity.get("device_id"), {})
        if not area_id:
            area_id = device.get("area_id")
        entity_name = entity.get("name") or entity.get("original_name")
        name = entity.get("name") or attributes.get("friendly_name") or entity.get("original_name")
        item = {
            "entity_id": entity_id,
            "name": name or entity_id,
            "entity_name": entity_name or name or entity_id,
            "area_name": areas.get(area_id),
            "device_name": device.get("name_by_user") or device.get("name"),
            "state": state.get("state"),
        }
        if _domain(entity_id) == "switch":
            switches.append(item)
        elif _domain(entity_id) in {"sensor", "input_number"} and (
            attributes.get("device_class") == "temperature"
            or attributes.get("unit_of_measurement") in {"°C", "°F"}
        ):
            item["unit"] = attributes.get("unit_of_measurement")
            temperature_sensors.append(item)

    trvs.sort(key=lambda item: item["name"].casefold())
    temperature_sensors.sort(key=lambda item: ((item["area_name"] or ""), item["name"]))
    switches.sort(key=lambda item: item["name"].casefold())

    trv_device_ids = {trv["device_id"] for trv in trvs}
    external_sensors = [
        sensor
        for sensor in temperature_sensors
        if next(
            (
                entity.get("device_id") not in trv_device_ids
                for entity in snapshot.entities
                if entity.get("entity_id") == sensor["entity_id"]
            ),
            True,
        )
    ]
    temperature_sensors = external_sensors

    for trv in trvs:
        group_key = _normalise(trv["suggested_group"])
        ranked_sensors: list[tuple[int, str]] = []
        for sensor in temperature_sensors:
            sensor_key = _normalise(
                f"{sensor['entity_id']} {sensor['name']} {sensor['area_name'] or ''}"
            )
            score = 0
            if trv["area_name"] and sensor["area_name"] == trv["area_name"]:
                score += 100
            if group_key and group_key in sensor_key:
                score += 50
            if "thermometer" in sensor_key:
                score += 5
            if score:
                ranked_sensors.append((score, sensor["entity_id"]))
        if ranked_sensors:
            trv["suggested_temperature_sensor"] = sorted(
                ranked_sensors, key=lambda item: (-item[0], item[1])
            )[0][1]

    def suggest_switch(words: tuple[str, ...]) -> str | None:
        ranked: list[tuple[int, str]] = []
        for switch in switches:
            haystack = _normalise(f"{switch['entity_id']} {switch['name']}")
            score = sum(1 for word in words if word in haystack)
            if score:
                ranked.append((score, switch["entity_id"]))
        return sorted(ranked, key=lambda item: (-item[0], item[1]))[0][1] if ranked else None

    return {
        "trvs": trvs,
        "temperature_sensors": temperature_sensors,
        "switches": switches,
        "suggested": {
            "boiler_switch": suggest_switch(("boiler", "central_heating")),
            "hot_water_switch": suggest_switch(("boiler", "hot_water")),
        },
    }


class TRVSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(min_length=1)
    room_group: str = Field(min_length=1, max_length=80)
    external_temperature_sensor: str | None = None

    @field_validator("device_id", "room_group")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value


class OnboardingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trvs: list[TRVSelection] = Field(min_length=1)
    boiler_switch: str
    hot_water_switch: str


def materialise_config(request: OnboardingRequest, discovery: dict[str, Any]) -> HeatingConfig:
    discovered_trvs = {trv["device_id"]: trv for trv in discovery["trvs"]}
    known_sensors = {sensor["entity_id"] for sensor in discovery["temperature_sensors"]}
    known_switches = {switch["entity_id"] for switch in discovery["switches"]}

    if request.boiler_switch not in known_switches:
        raise ValueError(f"Boiler switch is not available: {request.boiler_switch}")
    if request.hot_water_switch not in known_switches:
        raise ValueError(f"Hot-water switch is not available: {request.hot_water_switch}")

    selected: list[ControlledTRV] = []
    seen_devices: set[str] = set()
    for choice in request.trvs:
        if choice.device_id in seen_devices:
            raise ValueError(f"TRV selected more than once: {choice.device_id}")
        seen_devices.add(choice.device_id)
        trv = discovered_trvs.get(choice.device_id)
        if trv is None:
            raise ValueError(f"SONOFF TRV is not available: {choice.device_id}")
        if choice.external_temperature_sensor not in known_sensors | {None}:
            raise ValueError(
                f"Temperature sensor is not available: {choice.external_temperature_sensor}"
            )
        selected.append(
            ControlledTRV(
                device_id=trv["device_id"],
                name=trv["name"],
                manufacturer=trv.get("manufacturer"),
                model=trv.get("model"),
                software_version=trv.get("software_version"),
                area_name=trv.get("area_name"),
                room_group=choice.room_group,
                external_temperature_sensor=choice.external_temperature_sensor,
                entities=TRVEntities.model_validate(trv["entities"]),
            )
        )
    return HeatingConfig(
        updated_at=datetime.now(UTC),
        boiler_switch=request.boiler_switch,
        hot_water_switch=request.hot_water_switch,
        trvs=selected,
    )
