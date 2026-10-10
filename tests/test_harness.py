from __future__ import annotations

import aiohttp
from ha_heating.discovery import discover
from ha_heating.ha_client import HomeAssistantClient

from dev.harness import TOKEN, MockHomeAssistant, build_snapshot


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
    assert len(state["scenarios"]) == 4
    assert state["scenarios"][-1]["label"] == "No TRVs"
    assert len(state["rooms"]) == 8
    assert state["rooms"][0]["name"] == "Kitchen"
    assert state["relays"] == [
        {"id": "central_heating", "label": "Central heating relay", "state": "off"},
        {"id": "hot_water", "label": "Hot water relay", "state": "off"},
    ]
