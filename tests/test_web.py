from __future__ import annotations

from ha_heating.config import ConfigStore
from ha_heating.web import WebApplication


class FakeHomeAssistant:
    def __init__(self, snapshot):
        self.snapshot = snapshot

    async def get_registry_snapshot(self):
        return self.snapshot

    async def get_states(self):
        return self.snapshot.states


async def test_onboarding_api_discovers_and_saves(aiohttp_client, tmp_path, registry_snapshot):
    store = ConfigStore(tmp_path / "heating-config.json")
    app = WebApplication(FakeHomeAssistant(registry_snapshot), store).create()
    client = await aiohttp_client(app)

    discovery_response = await client.get("/api/onboarding/discovery")
    assert discovery_response.status == 200
    discovery = await discovery_response.json()
    assert discovery["trvs"][0]["name"] == "Dining TRV"

    save_response = await client.put(
        "/api/onboarding",
        json={
            "trvs": [
                {
                    "device_id": "device-dining",
                    "room_group": "Dining Room",
                    "external_temperature_sensor": "sensor.dining_thermometer_temperature",
                }
            ],
            "boiler_switch": "switch.boiler_switch_central_heating_switch",
            "hot_water_switch": "switch.boiler_switch_hot_water_switch",
        },
    )
    assert save_response.status == 200
    assert store.load().trvs[0].entities.climate == "climate.dining_trv"

    presets_response = await client.put(
        "/api/presets",
        json={"boost": 24, "comfort": 20.5, "eco": 15, "frost": 6},
    )
    assert presets_response.status == 200
    assert (await presets_response.json())["config"]["setup"]["presets"] is True
    assert store.load().presets.model_dump() == {
        "boost": 24.0,
        "comfort": 20.5,
        "eco": 15.0,
        "frost": 6.0,
    }

    invalid_presets_response = await client.put(
        "/api/presets",
        json={"boost": 23, "comfort": 21, "eco": 16, "frost": 20},
    )
    assert invalid_presets_response.status == 400
    invalid_presets = await invalid_presets_response.json()
    assert invalid_presets["error"] == "Presets are invalid"
    assert "descend from Boost to Frost" in invalid_presets["details"][0]["msg"]

    invalid_schedules_response = await client.put(
        "/api/schedules",
        json={
            "schedules": [
                {
                    "room_group": "Dining Room",
                    "default_preset": "eco",
                    "periods": [
                        {
                            "days": ["monday"],
                            "start": "06:30",
                            "end": "09:00",
                            "preset": "comfort",
                        },
                        {
                            "days": ["monday"],
                            "start": "08:30",
                            "end": "10:00",
                            "preset": "boost",
                        },
                    ],
                }
            ]
        },
    )
    assert invalid_schedules_response.status == 400
    invalid_schedules = await invalid_schedules_response.json()
    assert invalid_schedules["error"] == "Schedules are invalid"
    assert "overlap on Monday" in invalid_schedules["details"][0]["msg"]

    schedules_response = await client.put(
        "/api/schedules",
        json={
            "schedules": [
                {
                    "room_group": "Dining Room",
                    "default_preset": "eco",
                    "periods": [
                        {
                            "days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
                            "start": "06:30",
                            "end": "08:30",
                            "preset": "comfort",
                        }
                    ],
                }
            ]
        },
    )
    assert schedules_response.status == 200
    assert (await schedules_response.json())["config"]["setup"]["schedules"] is True
    assert store.load().schedules[0].periods[0].preset == "comfort"

    dashboard_response = await client.get("/api/dashboard")
    assert dashboard_response.status == 200
    dashboard = await dashboard_response.json()
    assert dashboard["groups"][0]["name"] == "Dining Room"
    assert dashboard["groups"][0]["rooms"] == [
        {
            "device_id": "device-dining",
            "name": "Dining Room",
            "trv_name": "Dining TRV",
            "climate_entity": "climate.dining_trv",
            "current_temperature_entity": "sensor.dining_thermometer_temperature",
            "current_temperature": 20.4,
            "target_temperature": 21.0,
            "unit": "°C",
            "available": True,
        }
    ]

    save_again_response = await client.put(
        "/api/onboarding",
        json={
            "trvs": [{"device_id": "device-dining", "room_group": "Dining Room"}],
            "boiler_switch": "switch.boiler_switch_central_heating_switch",
            "hot_water_switch": "switch.boiler_switch_hot_water_switch",
        },
    )
    assert save_again_response.status == 200
    assert store.load().presets.comfort == 20.5
    assert store.load().setup.presets is True
    assert store.load().setup.schedules is True
    assert store.load().schedules[0].room_group == "Dining Room"

    changed_group_response = await client.put(
        "/api/onboarding",
        json={
            "trvs": [{"device_id": "device-dining", "room_group": "Downstairs"}],
            "boiler_switch": "switch.boiler_switch_central_heating_switch",
            "hot_water_switch": "switch.boiler_switch_hot_water_switch",
        },
    )
    assert changed_group_response.status == 200
    assert store.load().setup.schedules is False
    assert store.load().schedules == []


async def test_onboarding_api_rejects_unknown_device(aiohttp_client, tmp_path, registry_snapshot):
    store = ConfigStore(tmp_path / "heating-config.json")
    app = WebApplication(FakeHomeAssistant(registry_snapshot), store).create()
    client = await aiohttp_client(app)

    response = await client.put(
        "/api/onboarding",
        json={
            "trvs": [{"device_id": "not-real", "room_group": "Nowhere"}],
            "boiler_switch": "switch.boiler_switch_central_heating_switch",
            "hot_water_switch": "switch.boiler_switch_hot_water_switch",
        },
    )

    assert response.status == 400
    assert "not available" in (await response.json())["error"]
