from __future__ import annotations

import copy
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

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


def test_control_plan_falls_back_to_internal_measurement(registry_snapshot):
    config = configured_system(registry_snapshot)
    states = copy.deepcopy(registry_snapshot.states)
    next(
        state for state in states if state["entity_id"] == "sensor.dining_thermometer_temperature"
    )["state"] = "unavailable"
    at = datetime(2026, 10, 12, 7, 0, tzinfo=ZoneInfo("Europe/London"))

    room = build_control_plan(config, states, at).rooms[0]

    assert room.current_temperature == 20.0
    assert room.current_temperature_entity == "climate.dining_trv"
    assert "using the TRV temperature" in str(room.warning)


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
