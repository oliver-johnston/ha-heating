from __future__ import annotations

import asyncio
import logging
import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from time import monotonic
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import HeatingConfig, HotWaterSchedule, PresetName, RoomSchedule
from .event_store import EventStore
from .ha_client import HomeAssistantClient, HomeAssistantError
from .notifications import DiscordNotifier, NotificationIssue

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


def _next_schedule_value(
    schedule: RoomSchedule, at: datetime
) -> tuple[datetime, PresetName] | None:
    """Return the next boundary that actually changes the active preset."""
    current = _active_value(schedule, at)
    candidates: set[datetime] = set()
    for day_offset in range(8):
        date = (at + timedelta(days=day_offset)).date()
        weekday = date.strftime("%A").lower()
        for period in schedule.periods:
            if weekday not in period.days:
                continue
            for value in (period.start, period.end):
                hours, minutes = (int(part) for part in value.split(":"))
                candidate = datetime.combine(
                    date, time(hour=hours, minute=minutes), tzinfo=at.tzinfo
                )
                if candidate > at:
                    candidates.add(candidate)
    for candidate in sorted(candidates):
        value = _active_value(schedule, candidate)
        if value != current:
            return candidate, value
    return None


def _is_available(state: dict[str, Any] | None) -> bool:
    return state is not None and state.get("state") not in {None, "unknown", "unavailable"}


def _state_age_seconds(state: dict[str, Any] | None, now: datetime) -> float | None:
    value = state.get("last_changed") if state else None
    if not isinstance(value, str):
        return None
    try:
        changed_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if changed_at.tzinfo is None:
        return None
    return max(0.0, (now - changed_at.astimezone(now.tzinfo)).total_seconds())


def _reported_age_seconds(state: dict[str, Any] | None, now: datetime) -> float | None:
    timestamp = _reported_timestamp(state)
    return _datetime_age_seconds(timestamp, now)


def _reported_timestamp(state: dict[str, Any] | None) -> datetime | None:
    if not state:
        return None
    for key in ("last_reported", "last_updated"):
        value = state.get(key)
        if not isinstance(value, str):
            continue
        try:
            reported_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            continue
        if reported_at.tzinfo is not None:
            return reported_at
    return None


def _datetime_age_seconds(value: datetime | None, now: datetime) -> float | None:
    if value is None:
        return None
    return max(0.0, (now - value.astimezone(now.tzinfo)).total_seconds())


def _timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return timestamp if timestamp.tzinfo is not None else None


def _timestamp_age_seconds(value: Any, now: datetime) -> float | None:
    return _datetime_age_seconds(_timestamp(value), now)


def _inferred_last_seen_entity(entity_id: str, states: dict[str, dict[str, Any]]) -> str | None:
    domain, _, object_id = entity_id.partition(".")
    if domain != "sensor" or not object_id.endswith("_temperature"):
        return None
    candidate = f"sensor.{object_id.removesuffix('_temperature')}_last_seen"
    return candidate if candidate in states else None


def _external_freshness(
    trv: Any,
    states: dict[str, dict[str, Any]],
    temperature_state: dict[str, Any] | None,
    now: datetime,
) -> tuple[str, str | None, datetime | None, float | None]:
    mode = trv.external_temperature_freshness
    health_entity = trv.external_temperature_last_seen
    if mode == "disabled":
        return mode, None, None, None
    if mode == "auto":
        health_entity = health_entity or _inferred_last_seen_entity(
            trv.external_temperature_sensor, states
        )
        mode = "last_seen" if health_entity else "state_updates"
    if mode == "last_seen" and health_entity:
        health_state = states.get(health_entity)
        timestamp = _timestamp(health_state.get("state") if health_state else None)
        return mode, health_entity, timestamp, _datetime_age_seconds(timestamp, now)
    timestamp = _reported_timestamp(temperature_state)
    return (
        "state_updates",
        trv.external_temperature_sensor,
        timestamp,
        _datetime_age_seconds(timestamp, now),
    )


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
    external_temperature_freshness: str | None = None
    external_temperature_health_entity: str | None = None
    external_temperature_last_seen_at: datetime | None = None
    external_temperature_age_seconds: float | None = None
    external_temperature_stale_after_seconds: int | None = None
    trv_last_seen_at: datetime | None = None
    next_schedule_at: datetime | None = None
    next_preset: PresetName | None = None
    next_scheduled_temperature: float | None = None
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
    started_at: datetime = field(default_factory=lambda: datetime.now().astimezone())
    plan: ControlPlan | None = None
    last_cycle_started_at: datetime | None = None
    last_cycle_finished_at: datetime | None = None
    last_successful_cycle_at: datetime | None = None
    last_error: str | None = None
    fault_latched: bool = False
    fault_reason: str | None = None
    consecutive_failures: int = 0
    notification_sent: bool = False
    loop_running: bool = False
    loop_restarts: int = 0
    actions: list[str] = field(default_factory=list)
    events: list[ControlEvent] = field(default_factory=list)


@dataclass(frozen=True)
class ControlEvent:
    occurred_at: datetime
    level: str
    message: str


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
            label="No safety fault awaiting acknowledgement",
            passed=not config.safety.fault_latched,
            severity="error",
            detail=(
                "No safety fault is latched."
                if not config.safety.fault_latched
                else config.safety.fault_reason or "Acknowledge the current safety fault first."
            ),
        )
    )

    setup_ready = config.setup.schedules and bool(config.schedules)
    checks.append(
        PreflightCheck(
            key="configuration",
            label="Configuration complete",
            passed=setup_ready,
            severity="error",
            detail=(
                "All setup steps and room schedules are complete."
                if setup_ready
                else "Complete devices, boiler, control, presets, and schedules first."
            ),
        )
    )

    now = datetime.now().astimezone()
    for trv in config.trvs:
        climate = states_by_entity.get(trv.entities.climate)
        attributes = climate.get("attributes", {}) if climate else {}
        temperature = _temperature(attributes.get("current_temperature"))
        if temperature is None and trv.entities.local_temperature:
            temperature = _temperature(
                states_by_entity.get(trv.entities.local_temperature, {}).get("state")
            )
        last_seen = states_by_entity.get(trv.entities.last_seen) if trv.entities.last_seen else None
        last_seen_age = _timestamp_age_seconds(last_seen.get("state") if last_seen else None, now)
        climate_age = _reported_age_seconds(climate, now)
        if trv.trv_freshness == "disabled":
            trv_age = None
        elif trv.trv_freshness == "state_updates":
            trv_age = climate_age
        else:
            trv_age = last_seen_age if last_seen_age is not None else climate_age
        stale = (
            trv.trv_freshness != "disabled"
            and last_seen is not None
            and not _is_available(last_seen)
            or trv_age is not None
            and trv_age > config.control.trv_stale_seconds
        )
        passed = _is_available(climate) and temperature is not None and not stale
        checks.append(
            PreflightCheck(
                key=f"trv:{trv.device_id}",
                label=f"{trv.area_name or trv.name} TRV available",
                passed=passed,
                severity="warning",
                detail=(
                    f"{trv.entities.climate} reports a usable internal temperature."
                    if passed
                    else (
                        f"{trv.entities.climate} is unavailable or has no temperature. "
                        "This room will be skipped and will not count towards heat demand."
                    )
                ),
            )
        )
        if trv.external_temperature_sensor:
            external = states_by_entity.get(trv.external_temperature_sensor)
            freshness_mode, health_entity, health_timestamp, external_age = _external_freshness(
                trv, states_by_entity, external, now
            )
            stale_after = (
                trv.external_sensor_stale_seconds or config.control.external_sensor_stale_seconds
            )
            health_unavailable = (
                freshness_mode == "last_seen"
                and health_entity is not None
                and (
                    not _is_available(states_by_entity.get(health_entity))
                    or health_timestamp is None
                )
            )
            external_ok = (
                _is_available(external)
                and _temperature(external.get("state")) is not None
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
            passed = _is_available(states_by_entity.get(entity_id))
            checks.append(
                PreflightCheck(
                    key=key,
                    label=label,
                    passed=passed,
                    severity="error",
                    detail=(
                        f"{entity_id} is available."
                        if passed
                        else f"Home Assistant cannot currently read {entity_id}."
                    ),
                )
            )

    ok = all(check.passed or check.severity != "error" for check in checks)
    return PreflightResult(ok=ok, checks=tuple(checks))


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

        last_seen = states_by_entity.get(trv.entities.last_seen) if trv.entities.last_seen else None
        last_seen_age = _timestamp_age_seconds(last_seen.get("state") if last_seen else None, at)
        climate_age = _reported_age_seconds(climate, at)
        if trv.trv_freshness == "disabled":
            trv_age = None
            trv_last_seen_at = None
        elif trv.trv_freshness == "state_updates":
            trv_age = climate_age
            trv_last_seen_at = _reported_timestamp(climate)
        else:
            trv_age = last_seen_age if last_seen_age is not None else climate_age
            trv_last_seen_at = _timestamp(
                last_seen.get("state") if last_seen else None
            ) or _reported_timestamp(climate)
        trv_stale = (
            trv.trv_freshness != "disabled"
            and last_seen is not None
            and not _is_available(last_seen)
            or trv_age is not None
            and trv_age > config.control.trv_stale_seconds
        )

        external_temperature = None
        current_temperature = trv_temperature
        current_entity = trv.entities.climate
        external_freshness = None
        external_health_entity = None
        external_last_seen_at = None
        external_age = None
        external_stale_after = None
        warning = None
        if trv.external_temperature_sensor:
            external_state = states_by_entity.get(trv.external_temperature_sensor)
            (
                external_freshness,
                external_health_entity,
                external_last_seen_at,
                external_age,
            ) = _external_freshness(trv, states_by_entity, external_state, at)
            external_stale_after = (
                trv.external_sensor_stale_seconds or config.control.external_sensor_stale_seconds
            )
            external_health_unavailable = (
                external_freshness == "last_seen"
                and external_health_entity is not None
                and (
                    not _is_available(states_by_entity.get(external_health_entity))
                    or external_last_seen_at is None
                )
            )
            external_stale = (
                external_health_unavailable
                or external_age is not None
                and external_age > external_stale_after
            )
            if _is_available(external_state) and not external_stale:
                external_temperature = _temperature(external_state.get("state"))
            if external_temperature is not None:
                current_temperature = external_temperature
                current_entity = trv.external_temperature_sensor
            elif external_stale:
                warning = "External room sensor is stale; using the TRV temperature"
            else:
                warning = "External room sensor unavailable; using the TRV temperature"

        available = _is_available(climate) and current_temperature is not None and not trv_stale
        if trv_stale:
            warning = "TRV has stopped reporting and this room is being skipped"
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
        next_schedule = _next_schedule_value(schedule, at)
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
                external_temperature_freshness=external_freshness,
                external_temperature_health_entity=external_health_entity,
                external_temperature_last_seen_at=external_last_seen_at,
                external_temperature_age_seconds=external_age,
                external_temperature_stale_after_seconds=external_stale_after,
                trv_last_seen_at=trv_last_seen_at,
                next_schedule_at=next_schedule[0] if next_schedule else None,
                next_preset=next_schedule[1] if next_schedule else None,
                next_scheduled_temperature=(
                    float(getattr(config.presets, next_schedule[1])) if next_schedule else None
                ),
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
    def __init__(
        self,
        ha: HomeAssistantClient,
        store: Any,
        *,
        event_store: EventStore | None = None,
        notifier: DiscordNotifier | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self.ha = ha
        self.store = store
        self.status = ControllerStatus()
        self.event_store = event_store or EventStore(store.events_path)
        self.notifier = notifier or DiscordNotifier(
            getattr(ha, "session", None), store.notification_state_path
        )
        self._sleep = sleep
        self._demands: dict[str, bool] = {}
        self._lock = asyncio.Lock()
        self._boiler_changed_at: float | None = None
        self._boiler_on_since: float | None = None
        self._was_enabled: bool | None = None
        self._load_events()

    async def preflight(self, config: HeatingConfig | None = None) -> PreflightResult:
        async with self._lock:
            config = config or self.store.load()
            if config is None:
                raise ValueError("Complete setup before checking automatic control")
            return build_preflight(config, await self.ha.get_states())

    async def emergency_stop(self) -> bool:
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            config.control.enabled = False
            config.updated_at = datetime.now().astimezone()
            self.store.save(config)
            stopped = await self._turn_off_relays(
                config,
                "because an emergency stop was requested",
            )
            self._was_enabled = False
            self._boiler_on_since = None
            self._record_event("warning", "Emergency stop requested; automatic control disabled")
            return stopped

    async def disable_control(self) -> bool:
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            config.control.enabled = False
            config.updated_at = datetime.now().astimezone()
            self.store.save(config)
            stopped = await self._turn_off_relays(
                config,
                "because automatic control was disabled",
            )
            self._was_enabled = False
            self._boiler_on_since = None
            self._record_event("warning", "Automatic control disabled; relays commanded off")
            return stopped

    async def pause_for_configuration_change(self, section: str) -> bool:
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            if not config.control.enabled:
                return True
            config.control.enabled = False
            config.updated_at = datetime.now().astimezone()
            self.store.save(config)
            stopped = await self._turn_off_relays(
                config,
                f"before changing {section}",
            )
            self._was_enabled = False
            self._boiler_on_since = None
            self._record_event(
                "warning",
                f"Automatic control paused before changing {section}; re-enable after review",
            )
            return stopped

    async def acknowledge_fault(self) -> None:
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            config.safety.fault_latched = False
            config.safety.fault_reason = None
            config.safety.fault_at = None
            config.updated_at = datetime.now().astimezone()
            self.store.save(config)
            self.status.fault_latched = False
            self.status.fault_reason = None
            self.status.consecutive_failures = 0
            self.status.last_error = None
            self._record_event("info", "Safety fault acknowledged; automatic control remains off")
            try:
                await self.ha.call_service(
                    "persistent_notification",
                    "dismiss",
                    {"notification_id": "ha_heating_fault"},
                )
            except HomeAssistantError as exc:
                log.warning("Could not dismiss heating fault notification: %s", exc)
            self.status.notification_sent = False
            try:
                await self.notifier.resolve_fault(config.notifications)
            except Exception as exc:
                log.warning(
                    "Unexpected recovery notification failure (%s)",
                    type(exc).__name__,
                )

    async def send_test_notification(self) -> None:
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            await self.notifier.send_test(config.notifications)

    async def run_once(self, at: datetime | None = None) -> ControlPlan | None:
        async with self._lock:
            self.status.last_cycle_started_at = datetime.now().astimezone()
            self.status.actions = []
            config: HeatingConfig | None = None
            states: list[dict[str, Any]] | None = None
            try:
                config = self.store.load()
                if config is None or not config.setup.schedules:
                    self.status.plan = None
                    self.status.last_error = None
                    return None
                self._restore_fault(config)
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

                if was_enabled is None and not config.control.enabled:
                    states_by_entity = {
                        state["entity_id"]: state
                        for state in states
                        if isinstance(state.get("entity_id"), str)
                    }
                    relay_reported_on = any(
                        entity_id and states_by_entity.get(entity_id, {}).get("state") == "on"
                        for entity_id in (config.boiler_switch, config.hot_water_switch)
                    )
                    if self.status.fault_latched or relay_reported_on:
                        await self._turn_off_relays(
                            config,
                            "during safe startup reconciliation",
                        )

                if self.status.fault_latched and not self.status.notification_sent:
                    await self._notify_fault(
                        self.status.fault_reason or "Unknown safety fault", config
                    )

                if config.control.enabled and not self.status.fault_latched:
                    if was_enabled is not True:
                        preflight = build_preflight(config, states)
                        if not preflight.ok:
                            failures = [
                                check.detail
                                for check in preflight.checks
                                if not check.passed and check.severity == "error"
                            ]
                            await self._latch_fault(
                                config,
                                "Automatic control pre-flight failed: " + " ".join(failures),
                            )
                    if not self.status.fault_latched:
                        applied = await self._apply(config, states, plan)
                        if applied:
                            self.status.consecutive_failures = 0
                        elif not self.status.fault_latched:
                            await self._register_failure(
                                config,
                                self.status.last_error or "One or more commands were not confirmed",
                            )
                elif was_enabled:
                    await self._turn_off_relays(
                        config,
                        "because automatic control was disabled",
                    )

                try:
                    await self.notifier.reconcile(
                        config.notifications,
                        self._notification_issues(config, states, plan),
                        at=at,
                    )
                except Exception as exc:
                    log.warning(
                        "Unexpected notification reconciliation failure (%s)",
                        type(exc).__name__,
                    )

                if self.status.last_error is None and not self.status.fault_latched:
                    self.status.last_successful_cycle_at = datetime.now().astimezone()
                return plan
            except (HomeAssistantError, OSError, ValueError) as exc:
                self.status.last_error = str(exc)
                self._record_event("error", f"Control cycle failed: {exc}")
                if config and config.control.enabled:
                    await self._register_failure(config, str(exc))
                log.warning("Heating control cycle failed: %s", exc)
                return None
            finally:
                self.status.last_cycle_finished_at = datetime.now().astimezone()

    async def run_forever(self, *, maximum_cycles: int | None = None) -> None:
        unexpected_failures = 0
        cycles = 0
        self.status.loop_running = True
        try:
            while maximum_cycles is None or cycles < maximum_cycles:
                started = monotonic()
                try:
                    await self.run_once()
                    unexpected_failures = 0
                    cycles += 1
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    unexpected_failures += 1
                    self.status.loop_restarts += 1
                    self.status.last_error = f"Unexpected controller failure: {exc}"
                    self._record_event("error", self.status.last_error)
                    log.exception("Unexpected heating controller failure")
                    if unexpected_failures >= 3:
                        raise RuntimeError(
                            "Heating controller repeatedly crashed; exiting for Supervisor restart"
                        ) from exc
                    await self._sleep(min(30, 2 ** (unexpected_failures - 1)))
                    continue
                try:
                    config = self.store.load()
                    interval = config.control.cycle_interval_seconds if config else 30
                except (OSError, ValueError):
                    interval = 30
                if maximum_cycles is None or cycles < maximum_cycles:
                    await self._sleep(max(1, interval - (monotonic() - started)))
        finally:
            self.status.loop_running = False

    def _restore_fault(self, config: HeatingConfig) -> None:
        if config.safety.fault_latched:
            self.status.fault_latched = True
            self.status.fault_reason = config.safety.fault_reason

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
            return
        else:
            self.status.events.append(event)
        del self.status.events[:-100]
        try:
            self.event_store.append(
                {
                    "occurred_at": event.occurred_at.isoformat(),
                    "level": event.level,
                    "message": event.message,
                }
            )
        except OSError as exc:
            log.warning("Could not persist heating event history: %s", exc)

    def _load_events(self) -> None:
        for item in self.event_store.load()[-100:]:
            try:
                occurred_at = datetime.fromisoformat(str(item["occurred_at"]))
                level = str(item["level"])
                message = str(item["message"])
            except (KeyError, TypeError, ValueError):
                continue
            if level in {"info", "warning", "error"}:
                self.status.events.append(
                    ControlEvent(occurred_at=occurred_at, level=level, message=message)
                )

    async def _register_failure(
        self,
        config: HeatingConfig,
        reason: str,
    ) -> None:
        self.status.consecutive_failures += 1
        if self.status.consecutive_failures >= config.control.failures_before_fault:
            await self._latch_fault(config, reason)

    async def _latch_fault(
        self,
        config: HeatingConfig,
        reason: str,
    ) -> None:
        first_fault = not self.status.fault_latched
        self.status.fault_latched = True
        self.status.fault_reason = reason
        self.status.last_error = reason
        config.control.enabled = False
        config.safety.fault_latched = True
        config.safety.fault_reason = reason
        config.safety.fault_at = datetime.now().astimezone()
        config.updated_at = datetime.now().astimezone()
        self.store.save(config)
        self._was_enabled = False
        if first_fault:
            self._record_event("error", f"Safety fault latched: {reason}")
        await self._turn_off_relays(config, "because a safety fault was latched")
        await self._notify_fault(reason, config)

    async def _notify_fault(self, reason: str, config: HeatingConfig) -> None:
        try:
            await self.ha.call_service(
                "persistent_notification",
                "create",
                {
                    "notification_id": "ha_heating_fault",
                    "title": "Home Heating safety fault",
                    "message": (
                        "Automatic heating control was disabled and the relays were "
                        f"commanded off. {reason}"
                    ),
                },
            )
            self.status.notification_sent = True
            self._record_event("info", "Created a Home Assistant safety notification")
        except HomeAssistantError as exc:
            self.status.notification_sent = False
            log.warning("Could not create heating fault notification: %s", exc)
        try:
            await self.notifier.notify_fault(config.notifications, reason)
        except Exception as exc:
            log.warning("Unexpected safety notification failure (%s)", type(exc).__name__)

    @staticmethod
    def _notification_issues(
        config: HeatingConfig,
        states: list[dict[str, Any]],
        plan: ControlPlan,
    ) -> list[NotificationIssue]:
        issues: list[NotificationIssue] = []
        trvs = {trv.device_id: trv for trv in config.trvs}
        for room in plan.rooms:
            trv = trvs[room.device_id]
            name = trv.area_name or trv.name
            if not room.available:
                issues.append(
                    NotificationIssue(
                        key=f"room:{room.device_id}:unavailable",
                        title=f"{name} is unavailable",
                        detail=(
                            "This room is being skipped and does not count towards heat demand. "
                            f"{room.warning or 'No usable room temperature is available.'}"
                        ),
                        severity="warning",
                    )
                )
            elif room.warning:
                issues.append(
                    NotificationIssue(
                        key=f"room:{room.device_id}:fallback",
                        title=f"{name} is using its fallback sensor",
                        detail=room.warning,
                        severity="warning",
                    )
                )

        states_by_entity = {
            state["entity_id"]: state for state in states if isinstance(state.get("entity_id"), str)
        }
        for key, name, entity_id in (
            ("central-heating", "Central-heating relay", config.boiler_switch),
            ("hot-water", "Hot-water relay", config.hot_water_switch),
        ):
            if entity_id and not _is_available(states_by_entity.get(entity_id)):
                issues.append(
                    NotificationIssue(
                        key=f"relay:{key}:unavailable",
                        title=f"{name} is unavailable",
                        detail=f"Home Assistant cannot read {entity_id}.",
                        severity="critical",
                    )
                )
        return issues

    async def _service(
        self,
        domain: str,
        service: str,
        data: dict[str, Any],
        description: str,
        *,
        retries: int = 0,
        verify_entity: str | None = None,
        expected_state: str | None = None,
        expected_attribute: str | None = None,
        expected_number: float | None = None,
    ) -> bool:
        error: str | None = None
        for attempt in range(retries + 1):
            try:
                await self.ha.call_service(domain, service, data)
                if verify_entity is None:
                    self._record_success(description)
                    return True
                verification_states = await self.ha.get_states()
                if self._state_matches(
                    verification_states,
                    verify_entity,
                    expected_state,
                    expected_attribute,
                    expected_number,
                ):
                    self._record_success(description)
                    return True
                error = f"Home Assistant did not confirm the expected state for {verify_entity}"
            except HomeAssistantError as exc:
                error = str(exc)
            if attempt < retries:
                await asyncio.sleep(0.2)

        message = error or f"Home Assistant did not confirm {description.lower()}"
        self.status.actions.append(f"Failed: {description}")
        self.status.last_error = message
        self._record_event("error", f"Failed: {description} — {message}")
        log.warning("Control action failed (%s): %s", description, message)
        return False

    def _record_success(self, description: str) -> None:
        self.status.actions.append(description)
        self._record_event("info", description)

    @staticmethod
    def _state_matches(
        states: list[dict[str, Any]],
        entity_id: str,
        expected_state: str | None,
        expected_attribute: str | None,
        expected_number: float | None,
    ) -> bool:
        state = next((item for item in states if item.get("entity_id") == entity_id), None)
        if not _is_available(state):
            return False
        if expected_attribute:
            actual: Any = state.get("attributes", {}).get(expected_attribute)
        else:
            actual = state.get("state")
        if expected_number is not None:
            number = _temperature(actual)
            return number is not None and math.isclose(number, expected_number, abs_tol=0.05)
        return expected_state is not None and actual == expected_state

    async def _apply(
        self, config: HeatingConfig, states: list[dict[str, Any]], plan: ControlPlan
    ) -> bool:
        states_by_entity = {
            state["entity_id"]: state for state in states if isinstance(state.get("entity_id"), str)
        }
        unavailable_relays = [
            name
            for name, entity_id in (
                ("central-heating relay", config.boiler_switch),
                ("hot-water relay", config.hot_water_switch),
            )
            if entity_id and not _is_available(states_by_entity.get(entity_id))
        ]
        if unavailable_relays:
            message = f"Critical {' and '.join(unavailable_relays)} unavailable"
            self.status.last_error = message
            self._record_event("error", message)
            return False
        success = True
        now = monotonic()
        boiler_state = states_by_entity.get(config.boiler_switch) if config.boiler_switch else None
        boiler_state_age = _state_age_seconds(boiler_state, datetime.now().astimezone())
        if plan.boiler_is_on is not None and self._boiler_changed_at is None:
            self._boiler_changed_at = now - (boiler_state_age or 0)
        if plan.boiler_is_on is True:
            if self._boiler_on_since is None:
                self._boiler_on_since = now - (boiler_state_age or 0)
        elif plan.boiler_is_on is False:
            self._boiler_on_since = None

        if (
            self._boiler_on_since is not None
            and now - self._boiler_on_since >= config.control.maximum_boiler_on_seconds
        ):
            await self._latch_fault(
                config,
                (
                    "Central heating exceeded the configured maximum continuous runtime of "
                    f"{config.control.maximum_boiler_on_seconds} seconds"
                ),
            )
            return False

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
                retries=config.control.command_retries,
                verify_entity=config.boiler_switch,
                expected_state="off",
            )
            success = success and changed
            if changed:
                self._boiler_changed_at = now
                self._boiler_on_since = None

        trvs = {trv.device_id: trv for trv in config.trvs}
        for decision in plan.rooms:
            trv = trvs[decision.device_id]
            climate = states_by_entity.get(trv.entities.climate, {})
            if not decision.available:
                continue
            if climate.get("state") != config.control.trv_mode:
                changed = await self._service(
                    "climate",
                    "set_hvac_mode",
                    {"entity_id": trv.entities.climate, "hvac_mode": config.control.trv_mode},
                    f"Set {trv.name} to heat mode",
                    retries=config.control.command_retries,
                    verify_entity=trv.entities.climate,
                    expected_state=config.control.trv_mode,
                )
                success = success and changed
            if decision.trv_target_temperature is None or not math.isclose(
                decision.trv_target_temperature, decision.commanded_temperature, abs_tol=0.05
            ):
                changed = await self._service(
                    "climate",
                    "set_temperature",
                    {
                        "entity_id": trv.entities.climate,
                        "temperature": decision.commanded_temperature,
                    },
                    f"Set {trv.name} to {decision.commanded_temperature:g}°C",
                    retries=config.control.command_retries,
                    verify_entity=trv.entities.climate,
                    expected_attribute="temperature",
                    expected_number=decision.commanded_temperature,
                )
                success = success and changed
            success = (
                await self._reconcile_entity(
                    config,
                    states_by_entity,
                    trv.entities.temperature_sensor_select,
                    "select",
                    "select_option",
                    "local_temperature",
                    "option",
                    f"Set {trv.name} temperature source to internal",
                )
                and success
            )
            success = (
                await self._reconcile_entity(
                    config,
                    states_by_entity,
                    trv.entities.smart_temperature_control,
                    "switch",
                    "turn_on" if config.control.smart_temperature_control else "turn_off",
                    "on" if config.control.smart_temperature_control else "off",
                    None,
                    f"Updated {trv.name} smart temperature control",
                )
                and success
            )
            success = (
                await self._reconcile_entity(
                    config,
                    states_by_entity,
                    trv.entities.open_window,
                    "switch",
                    "turn_on" if config.control.open_window_detection else "turn_off",
                    "on" if config.control.open_window_detection else "off",
                    None,
                    f"Updated {trv.name} open-window detection",
                )
                and success
            )
            success = (
                await self._reconcile_entity(
                    config,
                    states_by_entity,
                    trv.entities.child_lock,
                    "switch",
                    "turn_on" if config.control.child_lock else "turn_off",
                    "on" if config.control.child_lock else "off",
                    None,
                    f"Updated {trv.name} child lock",
                )
                and success
            )
            success = (
                await self._reconcile_number(
                    config,
                    states_by_entity,
                    trv.entities.frost_protection_temperature,
                    config.control.frost_protection_temperature,
                    f"Set {trv.name} frost protection",
                )
                and success
            )

        if (
            config.hot_water_switch
            and plan.hot_water_is_on is not None
            and plan.hot_water_should_be_on != plan.hot_water_is_on
        ):
            desired = bool(plan.hot_water_should_be_on)
            changed = await self._service(
                "switch",
                "turn_on" if desired else "turn_off",
                {"entity_id": config.hot_water_switch},
                f"Turned hot water {'on' if desired else 'off'}",
                retries=config.control.command_retries,
                verify_entity=config.hot_water_switch,
                expected_state="on" if desired else "off",
            )
            success = success and changed

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
                retries=config.control.command_retries,
                verify_entity=config.boiler_switch,
                expected_state="on",
            )
            success = success and changed
            if changed:
                self._boiler_changed_at = now
                self._boiler_on_since = now
        return success

    def _boiler_may_change(self, minimum_seconds: int, now: float) -> bool:
        return self._boiler_changed_at is None or now - self._boiler_changed_at >= minimum_seconds

    async def _turn_off_relays(
        self,
        config: HeatingConfig,
        reason: str,
    ) -> bool:
        success = True
        for entity_id, name in (
            (config.boiler_switch, "central heating"),
            (config.hot_water_switch, "hot water"),
        ):
            if entity_id:
                changed = await self._service(
                    "switch",
                    "turn_off",
                    {"entity_id": entity_id},
                    f"Turned {name} off {reason}",
                    retries=config.control.command_retries,
                    verify_entity=entity_id,
                    expected_state="off",
                )
                success = success and changed
        return success

    async def _reconcile_entity(
        self,
        config: HeatingConfig,
        states: dict[str, dict[str, Any]],
        entity_id: str | None,
        domain: str,
        service: str,
        desired: str,
        value_key: str | None,
        description: str,
    ) -> bool:
        if not entity_id or states.get(entity_id, {}).get("state") == desired:
            return True
        data: dict[str, Any] = {"entity_id": entity_id}
        if value_key:
            data[value_key] = desired
        return await self._service(
            domain,
            service,
            data,
            description,
            retries=config.control.command_retries,
            verify_entity=entity_id,
            expected_state=desired,
        )

    async def _reconcile_number(
        self,
        config: HeatingConfig,
        states: dict[str, dict[str, Any]],
        entity_id: str | None,
        desired: float,
        description: str,
    ) -> bool:
        if not entity_id:
            return True
        current = _temperature(states.get(entity_id, {}).get("state"))
        if current is not None and math.isclose(current, desired, abs_tol=0.05):
            return True
        return await self._service(
            "number",
            "set_value",
            {"entity_id": entity_id, "value": desired},
            description,
            retries=config.control.command_retries,
            verify_entity=entity_id,
            expected_number=desired,
        )
