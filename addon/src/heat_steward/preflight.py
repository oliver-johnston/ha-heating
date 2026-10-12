from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .config import HeatingConfig
from .entity_state import (
    external_freshness,
    is_available,
    reported_age_seconds,
    temperature,
    timestamp_age_seconds,
)


@dataclass(frozen=True)
class PreflightCheck:
    key: str
    label: str
    passed: bool
    severity: str
    detail: str


@dataclass(frozen=True)
class PreflightResult:
    ok: bool
    checks: tuple[PreflightCheck, ...]


def build_preflight(config: HeatingConfig, states: list[dict[str, Any]]) -> PreflightResult:
    states_by_entity = {
        state["entity_id"]: state for state in states if isinstance(state.get("entity_id"), str)
    }
    checks: list[PreflightCheck] = []

    checks.append(
        PreflightCheck(
            key="fault",
            label="No safety stop awaiting acknowledgement",
            passed=not config.safety.fault_latched,
            severity="error",
            detail=(
                "No safety stop is active."
                if not config.safety.fault_latched
                else config.safety.fault_reason or "Acknowledge the current safety stop first."
            ),
        )
    )

    setup_ready = (
        config.setup.devices
        and config.setup.boiler
        and config.setup.schedules
        and bool(config.schedules)
    )
    checks.append(
        PreflightCheck(
            key="configuration",
            label="Configuration complete",
            passed=setup_ready,
            severity="error",
            detail=(
                "Radiator, boiler, and schedule setup is complete."
                if setup_ready
                else "Complete Radiators, Boiler, and Schedules first."
            ),
        )
    )

    now = datetime.now().astimezone()
    for trv in config.trvs:
        climate = states_by_entity.get(trv.entities.climate)
        attributes = climate.get("attributes", {}) if climate else {}
        current_temperature = temperature(attributes.get("current_temperature"))
        if current_temperature is None and trv.entities.local_temperature:
            current_temperature = temperature(
                states_by_entity.get(trv.entities.local_temperature, {}).get("state")
            )
        last_seen = states_by_entity.get(trv.entities.last_seen) if trv.entities.last_seen else None
        last_seen_age = timestamp_age_seconds(last_seen.get("state") if last_seen else None, now)
        climate_age = reported_age_seconds(climate, now)
        if trv.trv_freshness == "disabled":
            trv_age = None
        elif trv.trv_freshness == "state_updates":
            trv_age = climate_age
        else:
            trv_age = last_seen_age if last_seen_age is not None else climate_age
        stale = (
            trv.trv_freshness != "disabled"
            and last_seen is not None
            and not is_available(last_seen)
            or trv_age is not None
            and trv_age > config.control.trv_stale_seconds
        )
        passed = is_available(climate) and current_temperature is not None and not stale
        if stale:
            detail = (
                f"{trv.entities.climate} has not reported within the configured "
                f"{config.control.trv_stale_seconds}-second freshness window. This room "
                "will be skipped and will not count towards heat demand."
            )
        elif passed:
            detail = f"{trv.entities.climate} reports a usable internal temperature."
        else:
            detail = (
                f"{trv.entities.climate} is unavailable or has no temperature. "
                "This room will be skipped and will not count towards heat demand."
            )
        checks.append(
            PreflightCheck(
                key=f"trv:{trv.device_id}",
                label=f"{trv.area_name or trv.name} TRV available",
                passed=passed,
                severity="warning",
                detail=detail,
            )
        )
        if trv.external_temperature_sensor:
            external = states_by_entity.get(trv.external_temperature_sensor)
            freshness_mode, health_entity, health_timestamp, external_age = external_freshness(
                trv, states_by_entity, external, now
            )
            stale_after = (
                trv.external_sensor_stale_seconds or config.control.external_sensor_stale_seconds
            )
            health_unavailable = (
                freshness_mode == "last_seen"
                and health_entity is not None
                and (
                    not is_available(states_by_entity.get(health_entity))
                    or health_timestamp is None
                )
            )
            external_ok = (
                is_available(external)
                and temperature(external.get("state")) is not None
                and not health_unavailable
                and not (external_age is not None and external_age > stale_after)
            )
            checks.append(
                PreflightCheck(
                    key=f"external:{trv.device_id}",
                    label=f"{trv.area_name or trv.name} external sensor available",
                    passed=external_ok,
                    severity="warning",
                    detail=(
                        f"{trv.external_temperature_sensor} is available."
                        if external_ok
                        else "The controller will safely fall back to the TRV's internal sensor."
                    ),
                )
            )

    for key, label, entity_id in (
        ("boiler", "Central-heating relay available", config.boiler_switch),
        ("hot_water", "Hot-water relay available", config.hot_water_switch),
    ):
        if entity_id:
            passed = is_available(states_by_entity.get(entity_id))
            checks.append(
                PreflightCheck(
                    key=key,
                    label=label,
                    passed=passed,
                    severity="warning",
                    detail=(
                        f"{entity_id} is available."
                        if passed
                        else (
                            f"Home Assistant cannot currently read {entity_id}. "
                            "This relay will be isolated and retried while the rest of "
                            "the system continues."
                        )
                    ),
                )
            )

    ok = all(check.passed or check.severity != "error" for check in checks)
    return PreflightResult(ok=ok, checks=tuple(checks))
