from ha_heating.config import ConfigStore
from ha_heating.discovery import OnboardingRequest, discover, materialise_config


def test_config_round_trip_is_versioned_and_atomic(tmp_path, registry_snapshot):
    result = discover(registry_snapshot)
    request = OnboardingRequest.model_validate(
        {
            "trvs": [{"device_id": "device-dining", "room_group": "Dining Room"}],
            "boiler_switch": "switch.boiler_switch_central_heating_switch",
            "hot_water_switch": "switch.boiler_switch_hot_water_switch",
        }
    )
    expected = materialise_config(request, result)
    store = ConfigStore(tmp_path / "nested" / "heating-config.json")

    store.save(expected)
    actual = store.load()

    assert actual == expected
    assert actual.schema_version == 1
    assert list((tmp_path / "nested").glob("*.tmp")) == []
