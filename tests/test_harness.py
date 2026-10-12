from __future__ import annotations

import asyncio
import contextlib
from datetime import UTC, datetime, timedelta

import aiohttp
from heat_steward.config import (
    ConfigStore,
    ControlledTRV,
    HeatingConfig,
    RoomSchedule,
    SetupProgress,
    TRVEntities,
)
from heat_steward.discovery import discover
from heat_steward.ha_client import HomeAssistantClient
from heat_steward.metrics import MetricsStore

from dev.harness import TOKEN, MockHomeAssistant, build_snapshot
from dev.history_seed import seed_simulator_history


def test_healthy_scenario_matches_expected_system():
    result = discover(build_snapshot("healthy"))

    assert len(result["trvs"]) == 8
    assert result["suggested"]["boiler_switch"] == "switch.boiler_switch_central_heating_switch"
    assert result["suggested"]["hot_water_switch"] == "switch.boiler_switch_hot_water_switch"
    kitchen = next(trv for trv in result["trvs"] if trv["name"] == "Kitchen TRV")
    assert kitchen["suggested_temperature_sensor"] == "sensor.kitchen_thermometer_temperature"
    assert kitchen["missing_recommended"] == []


def test_missing_entities_scenario_surfaces_warning():
    result = discover(build_snapshot("missing_entities"))
    dining = next(trv for trv in result["trvs"] if trv["name"] == "Dining TRV")

    assert dining["missing_recommended"] == [
        "external_temperature_input",
        "smart_temperature_control",
    ]


def test_no_trvs_scenario_keeps_other_devices():
    result = discover(build_snapshot("no_trvs"))

    assert result["trvs"] == []
    assert len(result["temperature_sensors"]) == 8
    assert len(result["switches"]) == 2


def test_offline_trv_remains_unavailable_in_live_snapshot():
    mock = MockHomeAssistant("offline_trv")
    states = {state["entity_id"]: state for state in mock.snapshot.states}

    assert states["climate.kitchen_trv"]["state"] == "unavailable"
    assert states["climate.dining_trv"]["state"] == "heat"


async def test_mock_server_exercises_real_rest_and_websocket_client(aiohttp_server):
    mock = MockHomeAssistant()
    server = await aiohttp_server(mock.create_app())

    async with aiohttp.ClientSession() as session:
        client = HomeAssistantClient(str(server.make_url("/")).rstrip("/"), TOKEN, session)
        snapshot = await client.get_registry_snapshot()
        assert await client.get_time_zone() == "Europe/London"
        await client.call_service(
            "climate",
            "set_temperature",
            {"entity_id": "climate.kitchen_trv", "temperature": 23},
        )

    assert len(snapshot.devices) == 17
    assert len(discover(snapshot)["trvs"]) == 8
    assert mock.room_values["kitchen"]["setpoint"] == 23


async def test_real_websocket_client_receives_home_assistant_mode_event(aiohttp_server):
    mock = MockHomeAssistant()
    server = await aiohttp_server(mock.create_app())
    received: list[dict[str, str]] = []
    handled = asyncio.Event()

    async def handle(data):
        received.append(data)
        handled.set()

    async with aiohttp.ClientSession() as session:
        client = HomeAssistantClient(str(server.make_url("/")).rstrip("/"), TOKEN, session)
        listener = asyncio.create_task(client.listen_events("heat_steward_set_mode", handle))
        await asyncio.wait_for(mock.event_subscription_ready.wait(), timeout=1)
        response = await session.post(
            server.make_url("/api/events/heat_steward_set_mode"),
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={"mode": "away"},
        )
        assert response.status == 200
        assert (await response.json())["listeners"] == 1
        await asyncio.wait_for(handled.wait(), timeout=1)
        listener.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await listener

    assert received == [{"mode": "away"}]


async def test_simulator_controls_change_entity_states(aiohttp_client):
    mock = MockHomeAssistant()
    client = await aiohttp_client(mock.create_app())

    response = await client.post(
        "/__harness/room/kitchen",
        data={
            "sensor_temperature": "16.5",
            "trv_temperature": "19.5",
            "setpoint": "22.5",
            "hvac_mode": "heat",
        },
        allow_redirects=False,
    )
    assert response.status == 303

    states = {state["entity_id"]: state for state in mock.snapshot.states}
    assert states["sensor.kitchen_thermometer_temperature"]["state"] == "16.5"
    assert states["climate.kitchen_trv"]["attributes"]["current_temperature"] == 19.5
    assert states["climate.kitchen_trv"]["attributes"]["temperature"] == 22.5
    assert states["climate.kitchen_trv"]["attributes"]["hvac_action"] == "heating"


async def test_simulator_state_describes_controls(aiohttp_client, tmp_path):
    mock = MockHomeAssistant()
    client = await aiohttp_client(mock.create_app(config_path=tmp_path / "config.json"))

    response = await client.get("/__harness/state")
    assert response.status == 200
    state = await response.json()

    assert state["current_scenario"] == "Healthy"
    assert state["configured"] is False
    assert len(state["scenarios"]) == 6
    assert state["scenarios"][-1]["label"] == "No TRVs"
    assert len(state["rooms"]) == 8
    assert state["rooms"][0]["name"] == "Kitchen"
    assert state["relays"] == [
        {"id": "central_heating", "label": "Central heating relay", "state": "off"},
        {"id": "hot_water", "label": "Hot water relay", "state": "off"},
    ]
    assert state["notifications"] == []


async def test_ignored_commands_scenario_records_without_changing_state(aiohttp_server):
    mock = MockHomeAssistant("ignored_commands")
    server = await aiohttp_server(mock.create_app())

    async with aiohttp.ClientSession() as session:
        client = HomeAssistantClient(str(server.make_url("/")).rstrip("/"), TOKEN, session)
        await client.call_service(
            "climate",
            "set_temperature",
            {"entity_id": "climate.kitchen_trv", "temperature": 23},
        )

    assert mock.room_values["kitchen"]["setpoint"] == 21
    assert len(mock.service_calls) == 1


def test_simulator_seeds_a_realistic_day_of_history_once(tmp_path):
    config = HeatingConfig(
        boiler_switch="switch.boiler",
        minimum_heat_requests=1,
        trvs=[
            ControlledTRV(
                device_id="mock-kitchen-trv",
                name="Kitchen TRV",
                area_name="Kitchen",
                room_group="Downstairs",
                external_temperature_sensor="sensor.kitchen_temperature",
                entities=TRVEntities(
                    climate="climate.kitchen_trv",
                    local_temperature="sensor.kitchen_trv_temperature",
                ),
            )
        ],
        setup=SetupProgress(boiler=True, schedules=True),
        schedules=[RoomSchedule(room_group="Downstairs")],
    )
    store = ConfigStore(tmp_path / "config.json")
    store.save(config)
    now = datetime(2026, 10, 12, 17, 0, tzinfo=UTC)

    assert seed_simulator_history(store, now=now) == 289
    metrics = MetricsStore(store.metrics_path)
    history = metrics.room_history(
        ["mock-kitchen-trv"],
        start_at=now - timedelta(hours=24, minutes=1),
        end_at=now + timedelta(minutes=1),
        bucket_seconds=300,
    )

    assert len(history) == 289
    assert {sample["scheduled_temperature"] for sample in history} == {16.0, 21.0}
    assert any(sample["heating"] for sample in history)
    assert any(
        sample["preset"] == "boost"
        and sample["target_temperature"] == 23.0
        and sample["scheduled_temperature"] != sample["target_temperature"]
        for sample in history
    )
    assert seed_simulator_history(store, now=now) == 0
    assert MetricsStore(store.metrics_path).health().cycle_count == 289
