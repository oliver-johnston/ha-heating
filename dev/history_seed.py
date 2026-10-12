from __future__ import annotations

import math
import sqlite3
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from heat_steward.config import ConfigStore, ControlledTRV, HeatingConfig, PresetName
from heat_steward.control_plan import ControlPlan, RoomDecision
from heat_steward.metrics import CycleCommandResults, MetricsStore

SEED_VERSION = "simulator-seed"
SEED_INTERVAL = timedelta(minutes=5)
SEED_DURATION = timedelta(hours=24)


def _minutes(at: datetime) -> int:
    return at.hour * 60 + at.minute


def _scheduled_preset(trv: ControlledTRV, at: datetime) -> PresetName:
    """Return a varied but recognisable domestic schedule for the demo history."""

    minute = _minutes(at)
    identity = f"{trv.area_name or ''} {trv.name} {trv.room_group}".lower()
    weekend = at.weekday() >= 5
    if "office" in identity:
        return "comfort" if not weekend and 8 * 60 + 30 <= minute < 17 * 60 + 30 else "eco"
    if "guest" in identity:
        return "comfort" if 18 * 60 <= minute < 20 * 60 else "eco"
    if "bed" in identity or "upstairs" in identity:
        morning_end = 9 * 60 if weekend else 8 * 60
        if 6 * 60 + 30 <= minute < morning_end or 20 * 60 <= minute < 22 * 60 + 30:
            return "comfort"
        return "eco"
    morning_end = 10 * 60 if weekend else 9 * 60
    if 6 * 60 + 30 <= minute < morning_end or 17 * 60 <= minute < 22 * 60 + 30:
        return "comfort"
    return "eco"


def _next_schedule(
    trv: ControlledTRV,
    at: datetime,
) -> tuple[datetime, PresetName]:
    current = _scheduled_preset(trv, at)
    candidate = at + SEED_INTERVAL
    for _ in range(round(timedelta(days=1) / SEED_INTERVAL)):
        preset = _scheduled_preset(trv, candidate)
        if preset != current:
            return candidate, preset
        candidate += SEED_INTERVAL
    return at + timedelta(days=1), current


def _hot_water_on(at: datetime) -> bool:
    minute = _minutes(at)
    return 6 * 60 + 15 <= minute < 8 * 60 or 17 * 60 + 30 <= minute < 19 * 60


def _history_is_complete(
    metrics: MetricsStore,
    config: HeatingConfig,
    end_at: datetime,
) -> bool:
    samples = metrics.room_history(
        [trv.device_id for trv in config.trvs],
        start_at=end_at - SEED_DURATION - SEED_INTERVAL,
        end_at=end_at + SEED_INTERVAL,
        bucket_seconds=round(SEED_INTERVAL.total_seconds()),
    )
    samples_by_room: dict[str, list[datetime]] = {trv.device_id: [] for trv in config.trvs}
    for sample in samples:
        samples_by_room.get(sample["device_id"], []).append(
            datetime.fromisoformat(sample["observed_at"])
        )
    return all(
        len(room_samples) >= 120
        and min(room_samples) <= end_at - timedelta(hours=23, minutes=30)
        and max(room_samples) >= end_at - timedelta(minutes=20)
        for room_samples in samples_by_room.values()
    )


def _remove_previous_seed(store: ConfigStore, metrics: MetricsStore) -> None:
    metrics.health()  # Initialise and migrate the database before using direct SQL.
    with sqlite3.connect(store.metrics_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("DELETE FROM control_cycles WHERE app_version = ?", (SEED_VERSION,))


def seed_simulator_history(
    store: ConfigStore,
    *,
    now: datetime | None = None,
) -> int:
    """Seed a rolling day of deterministic history for the local simulator.

    Existing seed rows are reused while they still cover the chart's last 24 hours.
    Real cycles written by the harness are never removed.
    """

    config = store.load()
    if config is None or not config.setup.schedules:
        return 0

    end_at = (now or datetime.now(UTC)).astimezone(UTC)
    end_at = end_at.replace(
        minute=end_at.minute - end_at.minute % 5,
        second=0,
        microsecond=0,
    )
    metrics = MetricsStore(store.metrics_path)
    if _history_is_complete(metrics, config, end_at):
        return 0
    _remove_previous_seed(store, metrics)

    zone = ZoneInfo("Europe/London")
    start_at = end_at - SEED_DURATION
    temperatures = {
        trv.device_id: min(
            config.presets.comfort - 1.2,
            config.presets.eco + 2.0 + (index % 4) * 0.25,
        )
        for index, trv in enumerate(config.trvs)
    }
    momentum = {trv.device_id: 0.0 for trv in config.trvs}
    previous_demands = {trv.device_id: False for trv in config.trvs}
    previous_heating = {trv.device_id: False for trv in config.trvs}
    boost_device_id = next(
        (
            trv.device_id
            for trv in config.trvs
            if "kitchen" in f"{trv.area_name or ''} {trv.name}".lower()
        ),
        config.trvs[0].device_id,
    )
    boost_start = end_at - timedelta(hours=4)
    boost_end = boost_start + timedelta(hours=1)
    cycles = round(SEED_DURATION / SEED_INTERVAL) + 1

    for step in range(cycles):
        at = start_at + step * SEED_INTERVAL
        local_at = at.astimezone(zone)
        progress = step / max(1, cycles - 1)

        for index, trv in enumerate(config.trvs):
            device_id = trv.device_id
            hour = local_at.hour + local_at.minute / 60
            ambient = config.presets.eco + 0.8 + 0.65 * math.sin((hour - 9) / 24 * math.tau)
            if previous_heating[device_id]:
                momentum[device_id] = min(1.35, momentum[device_id] + 0.32)
            else:
                momentum[device_id] *= 0.7
            radiator_gain = (0.085 + (index % 3) * 0.008) * momentum[device_id]
            cooling = (ambient - temperatures[device_id]) * (0.014 + (index % 2) * 0.002)
            natural_variation = 0.006 * math.sin(step * 0.37 + index * 1.7)
            temperatures[device_id] = max(
                config.presets.frost + 5,
                min(25.5, temperatures[device_id] + radiator_gain + cooling + natural_variation),
            )

        room_values: list[dict[str, object]] = []
        for index, trv in enumerate(config.trvs):
            schedule_preset = _scheduled_preset(trv, local_at)
            preset: PresetName = schedule_preset
            control_source = "schedule"
            override_until = None
            override_mode = None
            override_scope_type = None
            override_scope_id = None
            if trv.device_id == boost_device_id and boost_start <= at < boost_end:
                preset = "boost"
                control_source = "override"
                override_until = boost_end
                override_mode = "preset"
                override_scope_type = "room"
                override_scope_id = trv.device_id

            schedule_temperature = float(getattr(config.presets, schedule_preset))
            target = float(getattr(config.presets, preset))
            actual = round(temperatures[trv.device_id], 2)
            previous = previous_demands[trv.device_id]
            if actual <= target - config.control.hysteresis:
                demand = True
            elif actual >= target:
                demand = False
            else:
                demand = previous
            previous_demands[trv.device_id] = demand
            room_values.append(
                {
                    "index": index,
                    "trv": trv,
                    "schedule_preset": schedule_preset,
                    "preset": preset,
                    "schedule_temperature": schedule_temperature,
                    "target": target,
                    "actual": actual,
                    "demand": demand,
                    "control_source": control_source,
                    "override_until": override_until,
                    "override_mode": override_mode,
                    "override_scope_type": override_scope_type,
                    "override_scope_id": override_scope_id,
                }
            )

        heat_requests = sum(bool(room["demand"]) for room in room_values)
        boiler_requested = heat_requests >= config.minimum_heat_requests
        boiler_on = boiler_requested if config.boiler_switch else None
        hot_water_on = _hot_water_on(local_at) if config.hot_water_switch else None
        rooms: list[RoomDecision] = []

        for room in room_values:
            index = int(room["index"])
            trv = room["trv"]
            assert isinstance(trv, ControlledTRV)
            actual = float(room["actual"])
            demand = bool(room["demand"])
            target = float(room["target"])
            schedule_preset = room["schedule_preset"]
            preset = room["preset"]
            assert schedule_preset in {"boost", "comfort", "eco", "frost"}
            assert preset in {"boost", "comfort", "eco", "frost"}
            command = (
                round(
                    (
                        target + config.control.heating_offset
                        if demand
                        else target - config.control.idle_offset
                    )
                    * 2
                )
                / 2
            )
            trv_temperature = round(
                actual - 0.35 + 0.1 * math.sin(step * 0.21 + index),
                2,
            )
            still_warm = momentum[trv.device_id] > 0.2
            status = "heating" if demand else "closing" if still_warm else "idle"
            next_at, next_preset = _next_schedule(trv, local_at)
            external_entity = trv.external_temperature_sensor
            current_entity = (
                external_entity or trv.entities.local_temperature or trv.entities.climate
            )
            rooms.append(
                RoomDecision(
                    device_id=trv.device_id,
                    room_group=trv.room_group,
                    preset=preset,
                    schedule_preset=schedule_preset,
                    schedule_temperature=float(room["schedule_temperature"]),
                    scheduled_temperature=target,
                    current_temperature=actual,
                    current_temperature_entity=current_entity,
                    external_temperature=actual if external_entity else None,
                    trv_temperature=trv_temperature,
                    trv_target_temperature=command,
                    commanded_temperature=command,
                    demand=demand,
                    available=True,
                    hvac_mode="heat",
                    hvac_action="heating" if demand or still_warm else "idle",
                    status=status,
                    valve_opening_degree=92.0 if demand else 18.0 if still_warm else 0.0,
                    valve_closing_degree=0.0,
                    battery_level=round(91 - index * 1.4 - progress * 0.2, 1),
                    linkquality=round(76 + index * 2 + 8 * math.sin(step * 0.13 + index), 1),
                    external_temperature_freshness="last_seen" if external_entity else None,
                    external_temperature_age_seconds=30.0 + index * 4 if external_entity else None,
                    external_temperature_stale_after_seconds=(
                        trv.external_sensor_stale_seconds
                        or config.control.external_sensor_stale_seconds
                    ),
                    trv_last_seen_at=at - timedelta(seconds=12 + index * 3),
                    next_schedule_at=next_at.astimezone(UTC),
                    next_preset=next_preset,
                    next_scheduled_temperature=float(getattr(config.presets, next_preset)),
                    control_source=str(room["control_source"]),
                    override_until=room["override_until"],
                    override_mode=room["override_mode"],
                    override_scope_type=room["override_scope_type"],
                    override_scope_id=room["override_scope_id"],
                )
            )
            previous_heating[trv.device_id] = bool(demand and boiler_on)

        plan = ControlPlan(
            generated_at=at,
            rooms=tuple(rooms),
            heat_requests=heat_requests,
            boiler_should_be_on=boiler_requested,
            boiler_is_on=boiler_on,
            hot_water_should_be_on=hot_water_on,
            hot_water_is_on=hot_water_on,
            hot_water_next_change_at=None,
            hot_water_next_state=None,
        )
        metrics.record_cycle(
            config=config,
            plan=plan,
            heating_mode="home",
            commands=CycleCommandResults(),
            cycle_started_at=at - timedelta(milliseconds=180),
            cycle_finished_at=at,
            cycle_successful=True,
            control_error=None,
            fault_latched=False,
            fault_reason=None,
            app_version=SEED_VERSION,
            actions=(),
        )

    return cycles
