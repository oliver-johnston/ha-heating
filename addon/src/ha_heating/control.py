from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime
from time import monotonic
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import HeatingConfig, HotWaterSchedule, PresetName, RoomSchedule
from .ha_client import HomeAssistantClient, HomeAssistantError

log = logging.getLogger(__name__)


def _temperature(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _rounded_setpoint(value: float) -> float:
    return max(4.0, min(35.0, round(value * 2) / 2))


def _active_value(schedule: RoomSchedule, at: datetime) -> PresetName:
    weekday = at.strftime("%A").lower()
    current = at.strftime("%H:%M")
    for period in schedule.periods:
        if weekday in period.days and period.start <= current < period.end:
            return period.preset
    return schedule.default_preset


def _hot_water_state(schedule: HotWaterSchedule, at: datetime) -> str:
    weekday = at.strftime("%A").lower()
    current = at.strftime("%H:%M")
    for period in schedule.periods:
        if weekday in period.days and period.start <= current < period.end:
            return period.state
    return schedule.default_state


def _is_available(state: dict[str, Any] | None) -> bool:
    return state is not None and state.get("state") not in {None, "unknown", "unavailable"}


@dataclass(frozen=True)
class RoomDecision:
    device_id: str
    room_group: str
    preset: PresetName
    scheduled_temperature: float
    current_temperature: float | None
    current_temperature_entity: str
    external_temperature: float | None
    trv_temperature: float | None
    trv_target_temperature: float | None
    commanded_temperature: float
    demand: bool
    available: bool
    hvac_mode: str | None
    hvac_action: str | None
    status: str
    warning: str | None = None


@dataclass(frozen=True)
class ControlPlan:
    generated_at: datetime
    rooms: tuple[RoomDecision, ...]
    heat_requests: int
    boiler_should_be_on: bool
    boiler_is_on: bool | None
    hot_water_should_be_on: bool | None
    hot_water_is_on: bool | None


@dataclass
class ControllerStatus:
    plan: ControlPlan | None = None
    last_cycle_started_at: datetime | None = None
    last_cycle_finished_at: datetime | None = None
    last_successful_cycle_at: datetime | None = None
    last_error: str | None = None
    actions: list[str] = field(default_factory=list)
    events: list[ControlEvent] = field(default_factory=list)


@dataclass(frozen=True)
class ControlEvent:
    occurred_at: datetime
    level: str
    message: str


def build_control_plan(
    config: HeatingConfig,
    states: list[dict[str, Any]],
    at: datetime,
    previous_demands: dict[str, bool] | None = None,
) -> ControlPlan:
    states_by_entity = {
        state["entity_id"]: state for state in states if isinstance(state.get("entity_id"), str)
    }
    schedules = {schedule.room_group: schedule for schedule in config.schedules}
    previous_demands = previous_demands or {}
    decisions: list[RoomDecision] = []

    boiler_state = states_by_entity.get(config.boiler_switch) if config.boiler_switch else None
    boiler_is_on = boiler_state.get("state") == "on" if _is_available(boiler_state) else None

    for trv in config.trvs:
        schedule = schedules.get(trv.room_group)
        if schedule is None:
            continue
        preset = _active_value(schedule, at)
        desired = float(getattr(config.presets, preset))
        climate = states_by_entity.get(trv.entities.climate)
        attributes = climate.get("attributes", {}) if climate else {}
        trv_temperature = _temperature(attributes.get("current_temperature"))
        if trv_temperature is None and trv.entities.local_temperature:
            trv_temperature = _temperature(
                states_by_entity.get(trv.entities.local_temperature, {}).get("state")
            )

        external_temperature = None
        current_temperature = trv_temperature
        current_entity = trv.entities.climate
        warning = None
        if trv.external_temperature_sensor:
            external_state = states_by_entity.get(trv.external_temperature_sensor)
            if _is_available(external_state):
                external_temperature = _temperature(external_state.get("state"))
            if external_temperature is not None:
                current_temperature = external_temperature
                current_entity = trv.external_temperature_sensor
            else:
                warning = "External room sensor unavailable; using the TRV temperature"

        available = _is_available(climate) and current_temperature is not None
        previous = previous_demands.get(trv.device_id, False)
        if not available:
            demand = False
        elif current_temperature <= desired - config.control.hysteresis:
            demand = True
        elif current_temperature >= desired + config.control.hysteresis:
            demand = False
        else:
            demand = previous

        command = _rounded_setpoint(
            desired + config.control.heating_offset
            if demand
            else desired - config.control.idle_offset
        )
        hvac_mode = str(climate.get("state")) if climate else None
        hvac_action = attributes.get("hvac_action") or attributes.get("running_state")
        trv_heating = hvac_action in {"heat", "heating"}

        if not available:
            status = "unavailable"
        elif demand and trv_heating:
            status = "heating"
        elif demand and config.boiler_switch and not boiler_is_on:
            status = "waiting"
        elif demand:
            status = "opening"
        elif trv_heating:
            status = "closing"
        else:
            status = "idle"

        decisions.append(
            RoomDecision(
                device_id=trv.device_id,
                room_group=trv.room_group,
                preset=preset,
                scheduled_temperature=desired,
                current_temperature=current_temperature,
                current_temperature_entity=current_entity,
                external_temperature=external_temperature,
                trv_temperature=trv_temperature,
                trv_target_temperature=_temperature(attributes.get("temperature")),
                commanded_temperature=command,
                demand=demand,
                available=available,
                hvac_mode=hvac_mode,
                hvac_action=str(hvac_action) if hvac_action is not None else None,
                status=status,
                warning=warning,
            )
        )

    heat_requests = sum(decision.demand for decision in decisions if decision.available)
    boiler_should_be_on = bool(
        config.boiler_switch and heat_requests >= config.minimum_heat_requests
    )
    hot_water_state = (
        states_by_entity.get(config.hot_water_switch) if config.hot_water_switch else None
    )
    hot_water_is_on = (
        hot_water_state.get("state") == "on" if _is_available(hot_water_state) else None
    )
    hot_water_should_be_on = (
        _hot_water_state(config.hot_water_schedule, at) == "on" if config.hot_water_switch else None
    )

    return ControlPlan(
        generated_at=at,
        rooms=tuple(decisions),
        heat_requests=heat_requests,
        boiler_should_be_on=boiler_should_be_on,
        boiler_is_on=boiler_is_on,
        hot_water_should_be_on=hot_water_should_be_on,
        hot_water_is_on=hot_water_is_on,
    )


class HeatingController:
    def __init__(self, ha: HomeAssistantClient, store: Any):
        self.ha = ha
        self.store = store
        self.status = ControllerStatus()
        self._demands: dict[str, bool] = {}
        self._lock = asyncio.Lock()
        self._boiler_changed_at: float | None = None
        self._was_enabled: bool | None = None

    async def run_once(self, at: datetime | None = None) -> ControlPlan | None:
        async with self._lock:
            self.status.last_cycle_started_at = datetime.now().astimezone()
            self.status.actions = []
            try:
                config = self.store.load()
                if config is None or not config.setup.schedules:
                    self.status.plan = None
                    self.status.last_error = None
                    return None
                if at is None:
                    try:
                        zone = ZoneInfo(await self.ha.get_time_zone())
                    except (HomeAssistantError, ZoneInfoNotFoundError):
                        zone = datetime.now().astimezone().tzinfo
                    at = datetime.now(zone)
                states = await self.ha.get_states()
                plan = build_control_plan(config, states, at, self._demands)
                self._demands = {room.device_id: room.demand for room in plan.rooms}
                self.status.plan = plan
                self.status.last_error = None
                was_enabled = self._was_enabled
                self._was_enabled = config.control.enabled
                if was_enabled is None:
                    mode = "automatic control" if config.control.enabled else "monitoring-only mode"
                    self._record_event("info", f"Controller started in {mode}")
                elif was_enabled != config.control.enabled:
                    mode = "enabled" if config.control.enabled else "disabled"
                    self._record_event(
                        "warning" if config.control.enabled is False else "info",
                        f"Automatic control {mode}",
                    )
                if config.control.enabled:
                    await self._apply(config, states, plan)
                elif was_enabled:
                    await self._turn_off_relays(config, states)
                if self.status.last_error is None:
                    self.status.last_successful_cycle_at = datetime.now().astimezone()
                return plan
            except (HomeAssistantError, OSError, ValueError) as exc:
                self.status.last_error = str(exc)
                self._record_event("error", f"Control cycle failed: {exc}")
                log.warning("Heating control cycle failed: %s", exc)
                return None
            finally:
                self.status.last_cycle_finished_at = datetime.now().astimezone()

    async def run_forever(self) -> None:
        while True:
            started = monotonic()
            await self.run_once()
            try:
                config = self.store.load()
                interval = config.control.cycle_interval_seconds if config else 30
            except (OSError, ValueError):
                interval = 30
            await asyncio.sleep(max(1, interval - (monotonic() - started)))

    def _record_event(self, level: str, message: str) -> None:
        event = ControlEvent(
            occurred_at=datetime.now().astimezone(),
            level=level,
            message=message,
        )
        if (
            self.status.events
            and self.status.events[-1].level == level
            and self.status.events[-1].message == message
        ):
            self.status.events[-1] = event
        else:
            self.status.events.append(event)
        del self.status.events[:-100]

    async def _service(
        self, domain: str, service: str, data: dict[str, Any], description: str
    ) -> bool:
        try:
            await self.ha.call_service(domain, service, data)
            self.status.actions.append(description)
            self._record_event("info", description)
            return True
        except HomeAssistantError as exc:
            self.status.actions.append(f"Failed: {description}")
            self.status.last_error = str(exc)
            self._record_event("error", f"Failed: {description} — {exc}")
            log.warning("Control action failed (%s): %s", description, exc)
            return False

    async def _apply(
        self, config: HeatingConfig, states: list[dict[str, Any]], plan: ControlPlan
    ) -> None:
        states_by_entity = {
            state["entity_id"]: state for state in states if isinstance(state.get("entity_id"), str)
        }
        now = monotonic()
        if self._boiler_changed_at is None and plan.boiler_is_on is True:
            self._boiler_changed_at = now

        if (
            config.boiler_switch
            and plan.boiler_is_on is True
            and not plan.boiler_should_be_on
            and self._boiler_may_change(config.control.minimum_boiler_on_seconds, now)
        ):
            changed = await self._service(
                "switch",
                "turn_off",
                {"entity_id": config.boiler_switch},
                "Turned central heating off",
            )
            if changed:
                self._boiler_changed_at = now

        trvs = {trv.device_id: trv for trv in config.trvs}
        for decision in plan.rooms:
            trv = trvs[decision.device_id]
            climate = states_by_entity.get(trv.entities.climate, {})
            if not decision.available:
                continue
            if climate.get("state") != config.control.trv_mode:
                await self._service(
                    "climate",
                    "set_hvac_mode",
                    {"entity_id": trv.entities.climate, "hvac_mode": config.control.trv_mode},
                    f"Set {trv.name} to heat mode",
                )
            if decision.trv_target_temperature is None or not math.isclose(
                decision.trv_target_temperature, decision.commanded_temperature, abs_tol=0.05
            ):
                await self._service(
                    "climate",
                    "set_temperature",
                    {
                        "entity_id": trv.entities.climate,
                        "temperature": decision.commanded_temperature,
                    },
                    f"Set {trv.name} to {decision.commanded_temperature:g}°C",
                )
            await self._reconcile_entity(
                states_by_entity,
                trv.entities.temperature_sensor_select,
                "select",
                "select_option",
                "local_temperature",
                "option",
                f"Set {trv.name} temperature source to internal",
            )
            await self._reconcile_entity(
                states_by_entity,
                trv.entities.smart_temperature_control,
                "switch",
                "turn_on" if config.control.smart_temperature_control else "turn_off",
                "on" if config.control.smart_temperature_control else "off",
                None,
                f"Updated {trv.name} smart temperature control",
            )
            await self._reconcile_entity(
                states_by_entity,
                trv.entities.open_window,
                "switch",
                "turn_on" if config.control.open_window_detection else "turn_off",
                "on" if config.control.open_window_detection else "off",
                None,
                f"Updated {trv.name} open-window detection",
            )
            await self._reconcile_entity(
                states_by_entity,
                trv.entities.child_lock,
                "switch",
                "turn_on" if config.control.child_lock else "turn_off",
                "on" if config.control.child_lock else "off",
                None,
                f"Updated {trv.name} child lock",
            )
            await self._reconcile_number(
                states_by_entity,
                trv.entities.frost_protection_temperature,
                config.control.frost_protection_temperature,
                f"Set {trv.name} frost protection",
            )

        if (
            config.hot_water_switch
            and plan.hot_water_is_on is not None
            and plan.hot_water_should_be_on != plan.hot_water_is_on
        ):
            desired = bool(plan.hot_water_should_be_on)
            await self._service(
                "switch",
                "turn_on" if desired else "turn_off",
                {"entity_id": config.hot_water_switch},
                f"Turned hot water {'on' if desired else 'off'}",
            )

        if (
            config.boiler_switch
            and plan.boiler_is_on is False
            and plan.boiler_should_be_on
            and self._boiler_may_change(config.control.minimum_boiler_off_seconds, now)
        ):
            changed = await self._service(
                "switch",
                "turn_on",
                {"entity_id": config.boiler_switch},
                "Turned central heating on",
            )
            if changed:
                self._boiler_changed_at = now

    def _boiler_may_change(self, minimum_seconds: int, now: float) -> bool:
        return self._boiler_changed_at is None or now - self._boiler_changed_at >= minimum_seconds

    async def _turn_off_relays(self, config: HeatingConfig, states: list[dict[str, Any]]) -> None:
        states_by_entity = {
            state["entity_id"]: state for state in states if isinstance(state.get("entity_id"), str)
        }
        for entity_id, name in (
            (config.boiler_switch, "central heating"),
            (config.hot_water_switch, "hot water"),
        ):
            if entity_id and states_by_entity.get(entity_id, {}).get("state") == "on":
                await self._service(
                    "switch",
                    "turn_off",
                    {"entity_id": entity_id},
                    f"Turned {name} off because automatic control was disabled",
                )

    async def _reconcile_entity(
        self,
        states: dict[str, dict[str, Any]],
        entity_id: str | None,
        domain: str,
        service: str,
        desired: str,
        value_key: str | None,
        description: str,
    ) -> None:
        if not entity_id or states.get(entity_id, {}).get("state") == desired:
            return
        data: dict[str, Any] = {"entity_id": entity_id}
        if value_key:
            data[value_key] = desired
        await self._service(domain, service, data, description)

    async def _reconcile_number(
        self,
        states: dict[str, dict[str, Any]],
        entity_id: str | None,
        desired: float,
        description: str,
    ) -> None:
        if not entity_id:
            return
        current = _temperature(states.get(entity_id, {}).get("state"))
        if current is not None and math.isclose(current, desired, abs_tol=0.05):
            return
        await self._service(
            "number", "set_value", {"entity_id": entity_id, "value": desired}, description
        )
