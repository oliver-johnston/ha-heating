from __future__ import annotations

import copy
from datetime import datetime
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
from ha_heating.control import HeatingController, build_control_plan
from ha_heating.discovery import OnboardingRequest, discover, materialise_config


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
    def __init__(self, states):
        self.states = states
        self.calls = []

    async def get_states(self):
        return self.states

    async def get_time_zone(self):
        return "Europe/London"

    async def call_service(self, domain, service, data):
        self.calls.append((domain, service, data))
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
