from __future__ import annotations

import asyncio
import copy
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from ha_heating.config import (
    ConfigStore,
    ControlSettings,
    HotWaterPeriod,
    HotWaterSchedule,
    RoomSchedule,
    SchedulePeriod,
    SetupProgress,
)
from ha_heating.control import HeatingController, build_control_plan, build_preflight
from ha_heating.diagnostics import build_diagnostics
from ha_heating.discovery import OnboardingRequest, discover, materialise_config
from ha_heating.overrides import ActiveBoost, OverrideState

from dev.harness import build_snapshot


def configured_system(registry_snapshot, *, enabled: bool = False):
    config = materialise_config(
        OnboardingRequest.model_validate(
            {
                "trvs": [
                    {
                        "device_id": "device-dining",
                        "room_group": "Dining Room",
                        "external_temperature_sensor": "sensor.dining_thermometer_temperature",
                    }
                ]
            }
        ),
        discover(registry_snapshot),
    )
    config.boiler_switch = "switch.boiler_switch_central_heating_switch"
    config.hot_water_switch = "switch.boiler_switch_hot_water_switch"
    config.control = ControlSettings(
        enabled=enabled,
        minimum_boiler_on_seconds=0,
        minimum_boiler_off_seconds=0,
    )
    config.setup = SetupProgress(
        devices=True, boiler=True, control=True, presets=True, schedules=True
    )
    config.schedules = [
        RoomSchedule(
            room_group="Dining Room",
            default_preset="eco",
            periods=[SchedulePeriod(days=["monday"], start="06:00", end="09:00", preset="comfort")],
        )
    ]
    config.hot_water_schedule = HotWaterSchedule(
        periods=[HotWaterPeriod(days=["monday"], start="06:00", end="08:00", state="on")]
    )
    return config


def test_control_plan_uses_external_measurement_without_syncing_it_to_trv(registry_snapshot):
    config = configured_system(registry_snapshot)
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))

    plan = build_control_plan(config, registry_snapshot.states, at)

    room = plan.rooms[0]
    assert room.preset == "comfort"
    assert room.scheduled_temperature == 21
    assert room.current_temperature == 20.4
    assert room.external_temperature == 20.4
    assert room.trv_temperature == 20.0
    assert room.demand is True
    assert room.commanded_temperature == 23
    assert plan.boiler_should_be_on is True
    assert plan.hot_water_should_be_on is True


def test_control_plan_holds_previous_demand_inside_hysteresis(registry_snapshot):
    config = configured_system(registry_snapshot)
    states = copy.deepcopy(registry_snapshot.states)
    next(
        state for state in states if state["entity_id"] == "sensor.dining_thermometer_temperature"
    )["state"] = "21.0"
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))

    heating = build_control_plan(config, states, at, {"device-dining": True})
    idle = build_control_plan(config, states, at, {"device-dining": False})

    assert heating.rooms[0].demand is True
    assert idle.rooms[0].demand is False


def test_away_and_boost_override_schedule_with_boost_taking_precedence(registry_snapshot):
    config = configured_system(registry_snapshot)
    config.control.away_preset = "frost"
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))

    away = build_control_plan(
        config,
        registry_snapshot.states,
        at,
        overrides=OverrideState(mode="away"),
    )
    assert away.rooms[0].preset == "frost"
    assert away.rooms[0].scheduled_temperature == 5
    assert away.rooms[0].control_source == "away"

    boosted = build_control_plan(
        config,
        registry_snapshot.states,
        at,
        overrides=OverrideState(
            mode="away",
            boosts=[
                ActiveBoost(
                    room_group="Dining Room",
                    started_at=at,
                    expires_at=at + timedelta(hours=2),
                )
            ],
        ),
    )
    assert boosted.rooms[0].preset == "boost"
    assert boosted.rooms[0].scheduled_temperature == 23
    assert boosted.rooms[0].control_source == "boost"
    assert boosted.rooms[0].override_until == at + timedelta(hours=2)

    expired = build_control_plan(
        config,
        registry_snapshot.states,
        at + timedelta(hours=3),
        overrides=OverrideState(
            mode="away",
            boosts=[
                ActiveBoost(
                    room_group=None,
                    started_at=at,
                    expires_at=at + timedelta(hours=2),
                )
            ],
        ),
    )
    assert expired.rooms[0].preset == "frost"
    assert expired.rooms[0].control_source == "away"


async def test_modes_and_boosts_persist_and_home_assistant_event_only_sets_mode(
    tmp_path, registry_snapshot
):
    config = configured_system(registry_snapshot, enabled=False)
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    controller = HeatingController(RecordingHomeAssistant(registry_snapshot.states), store)

    await controller.handle_mode_event({"mode": "away"})
    await controller.start_boost("Dining Room", 120)

    restarted = HeatingController(RecordingHomeAssistant(registry_snapshot.states), store)
    state = restarted.get_override_state()
    assert state.mode == "away"
    assert state.boosts[0].room_group == "Dining Room"

    await restarted.handle_mode_event({"mode": "invalid"})
    assert restarted.get_override_state().mode == "away"
    assert restarted.get_override_state().boosts[0].room_group == "Dining Room"

    await restarted.cancel_boost("Dining Room")
    assert restarted.get_override_state().boosts == []
    assert any(
        event.message == "Heating mode changed to Away from Home Assistant automation"
        for event in controller.status.events
    )


def test_control_plan_falls_back_to_internal_measurement(registry_snapshot):
    config = configured_system(registry_snapshot)
    states = copy.deepcopy(registry_snapshot.states)
    next(
        state for state in states if state["entity_id"] == "sensor.dining_thermometer_temperature"
    )["state"] = "unavailable"
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))

    plan = build_control_plan(config, states, at)
    room = plan.rooms[0]

    assert room.current_temperature == 20.0
    assert room.current_temperature_entity == "climate.dining_trv"
    assert "using the TRV temperature" in str(room.warning)


def test_control_plan_falls_back_when_external_measurement_is_stale(registry_snapshot):
    config = configured_system(registry_snapshot)
    states = copy.deepcopy(registry_snapshot.states)
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))
    last_seen = next(
        state for state in states if state["entity_id"] == "sensor.dining_thermometer_last_seen"
    )
    last_seen["state"] = (at - timedelta(seconds=5401)).isoformat()

    plan = build_control_plan(config, states, at)
    room = plan.rooms[0]

    assert room.current_temperature == 20.0
    assert room.external_temperature is None
    assert room.available is True
    assert room.warning == "External room sensor is stale; using the TRV temperature"


def test_stable_external_measurement_uses_fresh_device_last_seen(registry_snapshot):
    config = configured_system(registry_snapshot)
    states = copy.deepcopy(registry_snapshot.states)
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))
    external = next(
        state for state in states if state["entity_id"] == "sensor.dining_thermometer_temperature"
    )
    external["last_reported"] = (at - timedelta(hours=6)).isoformat()

    plan = build_control_plan(config, states, at)
    room = plan.rooms[0]

    assert room.current_temperature == 20.4
    assert room.external_temperature == 20.4
    assert room.external_temperature_health_entity == "sensor.dining_thermometer_last_seen"
    assert room.warning is None


def test_external_sensor_freshness_can_be_disabled(registry_snapshot):
    config = configured_system(registry_snapshot)
    config.trvs[0].external_temperature_freshness = "disabled"
    states = copy.deepcopy(registry_snapshot.states)
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))
    last_seen = next(
        state for state in states if state["entity_id"] == "sensor.dining_thermometer_last_seen"
    )
    last_seen["state"] = (at - timedelta(days=1)).isoformat()

    room = build_control_plan(config, states, at).rooms[0]

    assert room.external_temperature == 20.4
    assert room.external_temperature_freshness == "disabled"
    assert room.warning is None


def test_external_sensor_can_override_the_stale_timeout(registry_snapshot):
    config = configured_system(registry_snapshot)
    config.trvs[0].external_sensor_stale_seconds = 300
    states = copy.deepcopy(registry_snapshot.states)
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))
    last_seen = next(
        state for state in states if state["entity_id"] == "sensor.dining_thermometer_last_seen"
    )
    last_seen["state"] = (at - timedelta(seconds=301)).isoformat()

    room = build_control_plan(config, states, at).rooms[0]

    assert room.external_temperature is None
    assert room.warning == "External room sensor is stale; using the TRV temperature"


def test_control_plan_reports_next_schedule_change(registry_snapshot):
    config = configured_system(registry_snapshot)
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))

    room = build_control_plan(config, registry_snapshot.states, at).rooms[0]

    assert room.next_schedule_at == datetime(2026, 10, 12, 9, 0, tzinfo=ZoneInfo("Europe/London"))
    assert room.next_preset == "eco"
    assert room.next_scheduled_temperature == 16


def test_control_plan_skips_a_stale_trv(registry_snapshot):
    config = configured_system(registry_snapshot)
    states = copy.deepcopy(registry_snapshot.states)
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))
    states.append(
        {
            "entity_id": "sensor.dining_trv_last_seen",
            "state": (at - timedelta(seconds=901)).isoformat(),
            "attributes": {},
        }
    )

    plan = build_control_plan(config, states, at)
    room = plan.rooms[0]

    assert room.available is False
    assert room.demand is False
    assert room.warning == "TRV has stopped reporting and this room is being skipped"
    assert plan.boiler_should_be_on is False


class RecordingHomeAssistant:
    def __init__(self, states, *, apply_commands: bool = True):
        self.states = copy.deepcopy(states)
        self.calls = []
        self.apply_commands = apply_commands

    async def get_states(self):
        return self.states

    async def get_time_zone(self):
        return "Europe/London"

    async def call_service(self, domain, service, data):
        self.calls.append((domain, service, data))
        if not self.apply_commands or domain == "persistent_notification":
            return []
        state = next(
            (item for item in self.states if item["entity_id"] == data.get("entity_id")),
            None,
        )
        if state is None:
            return []
        if domain == "climate" and service == "set_hvac_mode":
            state["state"] = data["hvac_mode"]
        elif domain == "climate" and service == "set_temperature":
            state["attributes"]["temperature"] = data["temperature"]
        elif domain == "switch" and service in {"turn_on", "turn_off"}:
            state["state"] = "on" if service == "turn_on" else "off"
        elif domain == "select" and service == "select_option":
            state["state"] = data["option"]
        elif domain == "number" and service == "set_value":
            state["state"] = str(data["value"])
        return []


class BrokenNotifier:
    async def reconcile(self, settings, issues, *, at=None):
        raise RuntimeError("Discord exploded")

    async def notify_fault(self, settings, reason):
        raise RuntimeError("Discord exploded")

    async def resolve_fault(self, settings):
        raise RuntimeError("Discord exploded")


async def test_notification_failure_does_not_fail_control_cycle(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot)
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    controller = HeatingController(
        RecordingHomeAssistant(registry_snapshot.states),
        store,
        notifier=BrokenNotifier(),
    )

    plan = await controller.run_once(datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London")))

    assert plan is not None
    assert controller.status.last_error is None
    assert controller.status.fault_latched is False


async def test_disabled_controller_only_calculates(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot, enabled=False)
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    ha = RecordingHomeAssistant(registry_snapshot.states)
    controller = HeatingController(ha, store)

    plan = await controller.run_once(datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London")))

    assert plan is not None
    assert plan.rooms[0].commanded_temperature == 23
    assert ha.calls == []
    assert controller.status.last_successful_cycle_at is not None
    assert controller.status.events[-1].message == "Controller started in monitoring-only mode"

    diagnostics = build_diagnostics(config, registry_snapshot.states, controller)
    assert diagnostics["overall_status"] == "monitoring"
    assert diagnostics["controller"]["loop_status"] == "healthy"
    assert diagnostics["plant"]["boiler"] == {
        "configured": True,
        "entity_id": "switch.boiler_switch_central_heating_switch",
        "requested": True,
        "actual": False,
    }
    assert diagnostics["rooms"][0]["temperature_source"] == "external"
    assert diagnostics["events"][0]["message"] == "Controller started in monitoring-only mode"


async def test_disabled_controller_turns_off_a_relay_found_on_at_startup(
    tmp_path, registry_snapshot
):
    config = configured_system(registry_snapshot, enabled=False)
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    states = copy.deepcopy(registry_snapshot.states)
    next(
        state
        for state in states
        if state["entity_id"] == "switch.boiler_switch_central_heating_switch"
    )["state"] = "on"
    ha = RecordingHomeAssistant(states)
    controller = HeatingController(ha, store)

    await controller.run_once(datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London")))

    assert (
        "switch",
        "turn_off",
        {"entity_id": "switch.boiler_switch_central_heating_switch"},
    ) in ha.calls
    assert (
        "switch",
        "turn_off",
        {"entity_id": "switch.boiler_switch_hot_water_switch"},
    ) in ha.calls


async def test_enabled_controller_reconciles_internal_trv_settings_without_external_sync(
    tmp_path, registry_snapshot
):
    config = configured_system(registry_snapshot, enabled=True)
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    ha = RecordingHomeAssistant(registry_snapshot.states)
    controller = HeatingController(ha, store)

    await controller.run_once(datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London")))

    assert (
        "climate",
        "set_temperature",
        {"entity_id": "climate.dining_trv", "temperature": 23.0},
    ) in ha.calls
    assert (
        "select",
        "select_option",
        {
            "entity_id": "select.dining_trv_temperature_sensor_select",
            "option": "local_temperature",
        },
    ) in ha.calls
    assert (
        "switch",
        "turn_off",
        {"entity_id": "switch.dining_trv_smart_temperature_control"},
    ) in ha.calls
    assert (
        "switch",
        "turn_on",
        {"entity_id": "switch.boiler_switch_central_heating_switch"},
    ) in ha.calls
    assert (
        "switch",
        "turn_on",
        {"entity_id": "switch.boiler_switch_hot_water_switch"},
    ) in ha.calls
    assert all(
        call[2].get("entity_id") != "number.dining_trv_external_temperature_input"
        for call in ha.calls
    )
    assert any(event.message == "Turned central heating on" for event in controller.status.events)


async def test_controller_can_start_heating_without_a_hot_water_switch(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot, enabled=True)
    config.hot_water_switch = None
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    ha = RecordingHomeAssistant(registry_snapshot.states)
    controller = HeatingController(ha, store)

    await controller.run_once(datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London")))

    assert (
        "switch",
        "turn_on",
        {"entity_id": "switch.boiler_switch_central_heating_switch"},
    ) in ha.calls


async def test_disabling_controller_turns_off_relays(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot, enabled=True)
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    ha = RecordingHomeAssistant(registry_snapshot.states)
    controller = HeatingController(ha, store)
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))
    await controller.run_once(at)

    states = copy.deepcopy(registry_snapshot.states)
    for state in states:
        if state["entity_id"] in {
            "switch.boiler_switch_central_heating_switch",
            "switch.boiler_switch_hot_water_switch",
        }:
            state["state"] = "on"
    ha.states = states
    ha.calls = []
    config.control.enabled = False
    store.save(config)

    await controller.run_once(at)

    assert (
        "switch",
        "turn_off",
        {"entity_id": "switch.boiler_switch_central_heating_switch"},
    ) in ha.calls
    assert (
        "switch",
        "turn_off",
        {"entity_id": "switch.boiler_switch_hot_water_switch"},
    ) in ha.calls


def test_preflight_warns_but_allows_an_unavailable_trv(registry_snapshot):
    config = configured_system(registry_snapshot, enabled=True)
    states = copy.deepcopy(registry_snapshot.states)
    next(state for state in states if state["entity_id"] == "climate.dining_trv")["state"] = (
        "unavailable"
    )

    result = build_preflight(config, states)

    assert result.ok is True
    assert any(
        check.key == "trv:device-dining"
        and not check.passed
        and check.severity == "warning"
        and "will not count towards heat demand" in check.detail
        for check in result.checks
    )


async def test_unavailable_trv_is_skipped_while_other_rooms_continue(tmp_path):
    snapshot = build_snapshot("healthy")
    config = materialise_config(
        OnboardingRequest.model_validate(
            {
                "trvs": [
                    {
                        "device_id": "mock-kitchen-trv",
                        "room_group": "Downstairs",
                        "external_temperature_sensor": "sensor.kitchen_thermometer_temperature",
                    },
                    {
                        "device_id": "mock-dining-trv",
                        "room_group": "Downstairs",
                        "external_temperature_sensor": "sensor.dining_thermometer_temperature",
                    },
                ]
            }
        ),
        discover(snapshot),
    )
    config.boiler_switch = "switch.boiler_switch_central_heating_switch"
    config.minimum_heat_requests = 1
    config.control = ControlSettings(
        enabled=True,
        minimum_boiler_on_seconds=0,
        minimum_boiler_off_seconds=0,
    )
    config.setup = SetupProgress(
        devices=True, boiler=True, control=True, presets=True, schedules=True
    )
    config.schedules = [RoomSchedule(room_group="Downstairs", default_preset="comfort")]
    states = copy.deepcopy(snapshot.states)
    next(state for state in states if state["entity_id"] == "climate.kitchen_trv")["state"] = (
        "unavailable"
    )
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    ha = RecordingHomeAssistant(states)
    controller = HeatingController(ha, store)

    plan = await controller.run_once(datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London")))

    assert plan is not None
    rooms = {room.device_id: room for room in plan.rooms}
    assert rooms["mock-kitchen-trv"].available is False
    assert rooms["mock-kitchen-trv"].demand is False
    assert rooms["mock-dining-trv"].available is True
    assert rooms["mock-dining-trv"].demand is True
    assert plan.heat_requests == 1
    assert plan.boiler_should_be_on is True
    assert controller.status.fault_latched is False
    assert all("kitchen_trv" not in str(call[2].get("entity_id")) for call in ha.calls)
    assert (
        "switch",
        "turn_on",
        {"entity_id": "switch.boiler_switch_central_heating_switch"},
    ) in ha.calls
    diagnostics = build_diagnostics(config, ha.states, controller)
    issue = next(issue for issue in diagnostics["issues"] if "Kitchen" in issue["title"])
    assert issue["severity"] == "warning"
    assert "does not count towards heat demand" in issue["detail"]


async def test_unconfirmed_commands_retry_then_latch_a_fault(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot, enabled=True)
    config.control.command_retries = 1
    config.control.failures_before_fault = 2
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    ha = RecordingHomeAssistant(registry_snapshot.states, apply_commands=False)
    controller = HeatingController(ha, store)
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))

    await controller.run_once(at)
    assert controller.status.consecutive_failures == 1
    assert store.load().control.enabled is True

    await controller.run_once(at)

    stored = store.load()
    assert stored.control.enabled is False
    assert stored.safety.fault_latched is True
    assert "did not confirm" in str(stored.safety.fault_reason)
    temperature_calls = [call for call in ha.calls if call[:2] == ("climate", "set_temperature")]
    assert len(temperature_calls) == 4
    assert any(call[:2] == ("persistent_notification", "create") for call in ha.calls)


async def test_relay_becoming_unavailable_latches_after_failed_cycles(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot, enabled=True)
    config.control.failures_before_fault = 3
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    ha = RecordingHomeAssistant(registry_snapshot.states)
    controller = HeatingController(ha, store)
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))

    await controller.run_once(at)
    relay = next(
        state
        for state in ha.states
        if state["entity_id"] == "switch.boiler_switch_central_heating_switch"
    )
    relay["state"] = "unavailable"

    await controller.run_once(at)
    await controller.run_once(at)
    assert store.load().control.enabled is True
    assert controller.status.consecutive_failures == 2

    await controller.run_once(at)

    stored = store.load()
    assert stored.control.enabled is False
    assert stored.safety.fault_latched is True
    assert "central-heating relay" in str(stored.safety.fault_reason)


async def test_control_loop_recovers_from_two_unexpected_failures(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot)
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)

    async def no_wait(_: float) -> None:
        await asyncio.sleep(0)

    class RecoveringController(HeatingController):
        attempts = 0

        async def run_once(self, at=None):
            del at
            self.attempts += 1
            if self.attempts < 3:
                raise RuntimeError("synthetic controller crash")
            return None

    controller = RecoveringController(
        RecordingHomeAssistant(registry_snapshot.states), store, sleep=no_wait
    )

    await controller.run_forever(maximum_cycles=1)

    assert controller.attempts == 3
    assert controller.status.loop_restarts == 2
    assert controller.status.loop_running is False
    assert any("synthetic controller crash" in event.message for event in controller.status.events)


async def test_control_loop_exits_after_three_consecutive_crashes(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot)
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)

    async def no_wait(_: float) -> None:
        await asyncio.sleep(0)

    class CrashingController(HeatingController):
        async def run_once(self, at=None):
            del at
            raise RuntimeError("persistent synthetic crash")

    controller = CrashingController(
        RecordingHomeAssistant(registry_snapshot.states), store, sleep=no_wait
    )

    with pytest.raises(RuntimeError, match="Supervisor restart"):
        await controller.run_forever(maximum_cycles=1)

    assert controller.status.loop_restarts == 3
    assert controller.status.loop_running is False


async def test_event_history_survives_controller_restart(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot, enabled=False)
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)

    first = HeatingController(RecordingHomeAssistant(registry_snapshot.states), store)
    await first.run_once(datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London")))
    second = HeatingController(RecordingHomeAssistant(registry_snapshot.states), store)

    assert any(
        event.message == "Controller started in monitoring-only mode"
        for event in second.status.events
    )


async def test_emergency_stop_persists_disabled_before_turning_relays_off(
    tmp_path, registry_snapshot
):
    config = configured_system(registry_snapshot, enabled=True)
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    states = copy.deepcopy(registry_snapshot.states)
    for state in states:
        if state["entity_id"] in {
            "switch.boiler_switch_central_heating_switch",
            "switch.boiler_switch_hot_water_switch",
        }:
            state["state"] = "on"
    ha = RecordingHomeAssistant(states)
    controller = HeatingController(ha, store)

    confirmed = await controller.emergency_stop()

    assert confirmed is True
    assert store.load().control.enabled is False
    assert (
        next(
            state
            for state in ha.states
            if state["entity_id"] == "switch.boiler_switch_central_heating_switch"
        )["state"]
        == "off"
    )
    assert (
        next(
            state
            for state in ha.states
            if state["entity_id"] == "switch.boiler_switch_hot_water_switch"
        )["state"]
        == "off"
    )


async def test_acknowledging_a_fault_does_not_reenable_control(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot, enabled=False)
    config.safety.fault_latched = True
    config.safety.fault_reason = "Test safety fault"
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    ha = RecordingHomeAssistant(registry_snapshot.states)
    controller = HeatingController(ha, store)

    await controller.acknowledge_fault()

    stored = store.load()
    assert stored.control.enabled is False
    assert stored.safety.fault_latched is False
    assert any(call[:2] == ("persistent_notification", "dismiss") for call in ha.calls)


async def test_maximum_continuous_boiler_runtime_latches_a_fault(tmp_path, registry_snapshot):
    config = configured_system(registry_snapshot, enabled=True)
    config.control.maximum_boiler_on_seconds = 300
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    states = copy.deepcopy(registry_snapshot.states)
    next(
        state
        for state in states
        if state["entity_id"] == "switch.boiler_switch_central_heating_switch"
    ).update(
        {
            "state": "on",
            "last_changed": (datetime.now().astimezone() - timedelta(seconds=301)).isoformat(),
        }
    )
    ha = RecordingHomeAssistant(states)
    controller = HeatingController(ha, store)

    await controller.run_once(datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London")))

    stored = store.load()
    assert stored.control.enabled is False
    assert stored.safety.fault_latched is True
    assert "maximum continuous runtime" in str(stored.safety.fault_reason)
