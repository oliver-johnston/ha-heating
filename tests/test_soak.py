from __future__ import annotations

import copy
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from ha_heating.config import (
    ConfigStore,
    ControlSettings,
    RoomSchedule,
    SchedulePeriod,
    SetupProgress,
)
from ha_heating.control import HeatingController
from ha_heating.discovery import OnboardingRequest, discover, materialise_config

from dev.harness import build_snapshot


class SoakHomeAssistant:
    def __init__(self, states):
        self.states = copy.deepcopy(states)
        self.calls: list[tuple[str, str, dict]] = []

    async def get_states(self):
        return self.states

    async def get_time_zone(self):
        return "Europe/London"

    async def call_service(self, domain, service, data):
        self.calls.append((domain, service, data))
        if domain == "persistent_notification":
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


@pytest.mark.soak
async def test_seven_simulated_days_with_transient_device_failures(tmp_path):
    snapshot = build_snapshot("healthy")
    selection = OnboardingRequest.model_validate(
        {
            "trvs": [
                {
                    "device_id": "mock-kitchen-trv",
                    "room_group": "Kitchen",
                    "external_temperature_sensor": "sensor.kitchen_thermometer_temperature",
                },
                {
                    "device_id": "mock-dining-trv",
                    "room_group": "Dining",
                    "external_temperature_sensor": "sensor.dining_thermometer_temperature",
                },
            ]
        }
    )
    config = materialise_config(selection, discover(snapshot))
    config.boiler_switch = "switch.boiler_switch_central_heating_switch"
    config.minimum_heat_requests = 1
    config.control = ControlSettings(
        enabled=True,
        minimum_boiler_on_seconds=0,
        minimum_boiler_off_seconds=0,
        maximum_boiler_on_seconds=21600,
        failures_before_alert=3,
    )
    config.setup = SetupProgress(
        devices=True, boiler=True, control=True, presets=True, schedules=True
    )
    periods = [
        SchedulePeriod(
            days=[
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            ],
            start="06:00",
            end="09:00",
            preset="comfort",
        ),
        SchedulePeriod(
            days=[
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            ],
            start="17:00",
            end="22:00",
            preset="comfort",
        ),
    ]
    config.schedules = [
        RoomSchedule(room_group="Kitchen", default_preset="eco", periods=periods),
        RoomSchedule(room_group="Dining", default_preset="eco", periods=periods),
    ]
    store = ConfigStore(tmp_path / "heating-config.json")
    store.save(config)
    ha = SoakHomeAssistant(snapshot.states)
    controller = HeatingController(ha, store)
    start = datetime(2026, 10, 12, 0, 0, tzinfo=ZoneInfo("Europe/London"))
    temperatures = {"kitchen": 18.0, "dining": 18.5}
    saw_external_fallback = False
    saw_skipped_trv = False
    saw_relay_failure = False

    for cycle in range(7 * 24 * 60 * 2):
        at = start + timedelta(seconds=cycle * 30)
        boiler = next(
            state
            for state in ha.states
            if state["entity_id"] == "switch.boiler_switch_central_heating_switch"
        )
        for room, temperature in temperatures.items():
            delta = 0.03 if boiler["state"] == "on" else -0.002
            temperatures[room] = max(12.0, min(23.0, temperature + delta))
            external = next(
                state
                for state in ha.states
                if state["entity_id"] == f"sensor.{room}_thermometer_temperature"
            )
            climate = next(
                state for state in ha.states if state["entity_id"] == f"climate.{room}_trv"
            )
            local = next(
                state
                for state in ha.states
                if state["entity_id"] == f"sensor.{room}_trv_local_temperature"
            )
            last_seen = next(
                state for state in ha.states if state["entity_id"] == f"sensor.{room}_trv_last_seen"
            )
            external["state"] = f"{temperatures[room]:.2f}"
            external["last_reported"] = at.isoformat()
            climate["attributes"]["current_temperature"] = round(temperatures[room] - 0.3, 2)
            local["state"] = f"{temperatures[room] - 0.3:.2f}"
            last_seen["state"] = at.isoformat()

        # A stale external sensor falls back for an hour without stopping the room.
        if 24 * 120 <= cycle < 26 * 120:
            kitchen_sensor = next(
                state
                for state in ha.states
                if state["entity_id"] == "sensor.kitchen_thermometer_temperature"
            )
            kitchen_sensor["last_reported"] = (at - timedelta(seconds=1801)).isoformat()

        # One unavailable TRV is isolated for an hour.
        dining_climate = next(
            state for state in ha.states if state["entity_id"] == "climate.dining_trv"
        )
        if 50 * 120 <= cycle < 52 * 120:
            dining_climate["state"] = "unavailable"
        elif dining_climate["state"] == "unavailable":
            dining_climate["state"] = "heat"

        # One missed relay state is tolerated; repeated misses are covered by unit tests.
        if cycle == 4 * 24 * 120:
            boiler["state"] = "unavailable"
            saw_relay_failure = True
        elif boiler["state"] == "unavailable":
            boiler["state"] = "off"

        plan = await controller.run_once(at)
        assert plan is not None
        saw_external_fallback |= any(
            room.warning is not None and "stale" in room.warning for room in plan.rooms
        )
        saw_skipped_trv |= any(not room.available for room in plan.rooms)

        if boiler["state"] != "unavailable":
            assert (boiler["state"] == "on") is plan.boiler_should_be_on

    stored = store.load()
    assert stored.control.enabled is True
    assert stored.safety.fault_latched is False
    assert controller.status.consecutive_failures == 0
    assert saw_external_fallback is True
    assert saw_skipped_trv is True
    assert saw_relay_failure is True
    assert any(call[:2] == ("switch", "turn_on") for call in ha.calls)
    assert any(call[:2] == ("switch", "turn_off") for call in ha.calls)
