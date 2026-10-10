import json

from ha_heating.config import (
    ConfigStore,
    HeatingConfig,
    RoomSchedule,
    SchedulePeriod,
    SetupProgress,
    TemperaturePresets,
)
from ha_heating.discovery import OnboardingRequest, discover, materialise_config
from pydantic import ValidationError


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
    assert actual.presets == TemperaturePresets(boost=23, comfort=21, eco=16, frost=5)
    assert actual.setup == SetupProgress(devices=True, presets=False, schedules=False)
    assert list((tmp_path / "nested").glob("*.tmp")) == []

    legacy_payload = expected.model_dump(mode="json")
    del legacy_payload["presets"]
    del legacy_payload["setup"]
    del legacy_payload["schedules"]
    store.path.write_text(json.dumps(legacy_payload), encoding="utf-8")
    assert store.load().presets == TemperaturePresets()
    assert store.load().setup == SetupProgress()
    assert store.load().schedules == []


def test_presets_must_descend_from_boost_to_frost():
    try:
        TemperaturePresets(boost=21, comfort=23, eco=16, frost=5)
    except ValidationError as exc:
        assert "descend from Boost to Frost" in str(exc)
    else:
        raise AssertionError("Expected invalid preset order to be rejected")


def test_room_schedule_rejects_overlapping_periods():
    try:
        RoomSchedule(
            room_group="Downstairs",
            periods=[
                SchedulePeriod(days=["monday"], start="06:30", end="09:00", preset="comfort"),
                SchedulePeriod(days=["monday"], start="08:30", end="10:00", preset="boost"),
            ],
        )
    except ValidationError as exc:
        assert "overlap on Monday" in str(exc)
    else:
        raise AssertionError("Expected overlapping schedule periods to be rejected")


def test_completed_schedules_must_cover_every_room_group(registry_snapshot):
    result = discover(registry_snapshot)
    request = OnboardingRequest.model_validate(
        {
            "trvs": [{"device_id": "device-dining", "room_group": "Dining Room"}],
            "boiler_switch": "switch.boiler_switch_central_heating_switch",
            "hot_water_switch": "switch.boiler_switch_hot_water_switch",
        }
    )
    payload = materialise_config(request, result).model_dump(mode="json")
    payload["setup"]["schedules"] = True

    try:
        HeatingConfig.model_validate(payload)
    except ValidationError as exc:
        assert "must include every room group" in str(exc)
    else:
        raise AssertionError("Expected an incomplete completed schedule to be rejected")
