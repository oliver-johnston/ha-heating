from __future__ import annotations

import pytest
from ha_heating.ha_client import RegistrySnapshot


@pytest.fixture
def registry_snapshot() -> RegistrySnapshot:
    device_id = "device-dining"
    entities = [
        {"entity_id": "climate.dining_trv", "device_id": device_id, "disabled_by": None},
        {"entity_id": "number.dining_trv_external_temperature_input", "device_id": device_id},
        {"entity_id": "sensor.dining_trv_local_temperature", "device_id": device_id},
        {"entity_id": "sensor.dining_trv_battery", "device_id": device_id},
        {"entity_id": "sensor.dining_trv_last_seen", "device_id": device_id},
        {"entity_id": "sensor.0x123_linkquality", "device_id": device_id},
        {"entity_id": "switch.dining_trv_child_lock", "device_id": device_id},
        {"entity_id": "switch.dining_trv_smart_temperature_control", "device_id": device_id},
        {"entity_id": "number.dining_trv_valve_opening_degree", "device_id": device_id},
        {
            "entity_id": "sensor.dining_thermometer_temperature",
            "device_id": "thermometer",
            "area_id": "dining",
            "original_name": "Temperature",
        },
        {"entity_id": "switch.boiler_switch_central_heating_switch", "device_id": "boiler"},
        {"entity_id": "switch.boiler_switch_hot_water_switch", "device_id": "boiler"},
    ]
    states = [
        {
            "entity_id": "sensor.dining_thermometer_temperature",
            "state": "20.4",
            "attributes": {
                "friendly_name": "Dining thermometer Temperature",
                "device_class": "temperature",
                "unit_of_measurement": "°C",
            },
        },
        {
            "entity_id": "switch.boiler_switch_central_heating_switch",
            "state": "off",
            "attributes": {"friendly_name": "Central Heating Switch"},
        },
        {
            "entity_id": "switch.boiler_switch_hot_water_switch",
            "state": "off",
            "attributes": {"friendly_name": "Hot Water Switch"},
        },
    ]
    return RegistrySnapshot(
        devices=[
            {
                "id": device_id,
                "name": "Dining TRV",
                "manufacturer": "SONOFF",
                "model": "Zigbee thermostatic radiator valve",
                "sw_version": "1.4.4",
                "area_id": "dining",
            },
            {"id": "thermometer", "name": "Dining thermometer", "area_id": "dining"},
            {"id": "boiler", "name": "Boiler Switch", "area_id": "utility"},
        ],
        entities=entities,
        areas=[
            {"area_id": "dining", "name": "Dining Room"},
            {"area_id": "utility", "name": "Utility Room"},
        ],
        states=states,
    )
