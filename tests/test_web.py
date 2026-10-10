from __future__ import annotations

from ha_heating.config import ConfigStore
from ha_heating.web import WebApplication


class FakeHomeAssistant:
    def __init__(self, snapshot):
        self.snapshot = snapshot

    async def get_registry_snapshot(self):
        return self.snapshot


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
