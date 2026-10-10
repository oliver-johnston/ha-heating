from ha_heating.discovery import OnboardingRequest, discover, materialise_config


def test_discovers_sonoff_trv_and_maps_related_entities(registry_snapshot):
    result = discover(registry_snapshot)

    assert len(result["trvs"]) == 1
    trv = result["trvs"][0]
    assert trv["name"] == "Dining TRV"
    assert trv["model"] == "Zigbee thermostatic radiator valve"
    assert trv["software_version"] == "1.4.4"
    assert trv["area_name"] == "Dining Room"
    assert trv["suggested_group"] == "Dining"
    assert trv["suggested_temperature_sensor"] == "sensor.dining_thermometer_temperature"
    assert trv["entities"]["climate"] == "climate.dining_trv"
    assert (
        trv["entities"]["external_temperature_input"]
        == "number.dining_trv_external_temperature_input"
    )
    assert trv["entities"]["child_lock"] == "switch.dining_trv_child_lock"
    assert trv["entities"]["linkquality"] == "sensor.0x123_linkquality"
    assert result["suggested"]["boiler_switch"] == "switch.boiler_switch_central_heating_switch"
    assert result["suggested"]["hot_water_switch"] == "switch.boiler_switch_hot_water_switch"


def test_materialises_only_server_discovered_entities(registry_snapshot):
    result = discover(registry_snapshot)
    request = OnboardingRequest.model_validate(
        {
            "trvs": [
                {
                    "device_id": "device-dining",
                    "room_group": "Downstairs",
                    "external_temperature_sensor": "sensor.dining_thermometer_temperature",
                }
            ],
            "boiler_switch": "switch.boiler_switch_central_heating_switch",
            "hot_water_switch": "switch.boiler_switch_hot_water_switch",
        }
    )

    config = materialise_config(request, result)

    assert config.trvs[0].room_group == "Downstairs"
    assert config.trvs[0].entities.climate == "climate.dining_trv"
    assert config.trvs[0].external_temperature_sensor == "sensor.dining_thermometer_temperature"


def test_rejects_unknown_selected_sensor(registry_snapshot):
    result = discover(registry_snapshot)
    request = OnboardingRequest.model_validate(
        {
            "trvs": [
                {
                    "device_id": "device-dining",
                    "room_group": "Dining Room",
                    "external_temperature_sensor": "sensor.not_real",
                }
            ],
            "boiler_switch": "switch.boiler_switch_central_heating_switch",
            "hot_water_switch": "switch.boiler_switch_hot_water_switch",
        }
    )

    try:
        materialise_config(request, result)
    except ValueError as exc:
        assert "not available" in str(exc)
    else:
        raise AssertionError("Expected unknown sensor to be rejected")
