from datetime import UTC, datetime, timedelta

import pytest
from heat_steward.overrides import (
    OverrideActionRequest,
    OverrideActor,
    OverrideStore,
    reduce_override_actions,
)
from pydantic import ValidationError

NOW = datetime(2026, 10, 11, 8, 0, tzinfo=UTC)
ACTOR = OverrideActor(source="dashboard", user_id="user-1", name="Oliver")


def temperature_action(
    *,
    scope_type: str = "house",
    scope_id: str | None = None,
    preset: str = "boost",
    duration_minutes: int = 60,
) -> OverrideActionRequest:
    return OverrideActionRequest.model_validate(
        {
            "channel": "temperature",
            "scope_type": scope_type,
            "scope_id": scope_id,
            "override_mode": "preset",
            "override_preset": preset,
            "duration_minutes": duration_minutes,
        }
    )


@pytest.mark.parametrize(
    "payload",
    [
        {
            "channel": "temperature",
            "scope_type": "group",
            "override_mode": "preset",
            "override_preset": "boost",
        },
        {
            "channel": "hot_water",
            "scope_type": "house",
            "override_mode": "on_off",
            "on_off": True,
        },
        {
            "channel": "occupancy",
            "scope_type": "house",
            "override_mode": "mode",
            "mode": "away",
            "duration_minutes": 60,
        },
        {
            "channel": "temperature",
            "scope_type": "room",
            "scope_id": "room-1",
            "operation": "clear",
            "duration_minutes": 60,
        },
    ],
)
def test_action_requests_reject_inconsistent_shapes(payload):
    with pytest.raises(ValidationError):
        OverrideActionRequest.model_validate(payload)


def test_action_ledger_persists_actor_and_is_idempotent(tmp_path):
    path = tmp_path / "heat-steward-actions.json"
    store = OverrideStore(path)
    request = temperature_action(scope_type="group", scope_id="Dining")

    recorded = store.record(request, ACTOR, at=NOW, action_id="request-123")
    duplicate = store.record(
        request,
        OverrideActor(source="dashboard", name="Someone else"),
        at=NOW + timedelta(minutes=1),
        action_id="request-123",
    )

    assert duplicate == recorded
    assert len(OverrideStore(path).load_ledger().actions) == 1
    state = OverrideStore(path).load(NOW + timedelta(minutes=2))
    assert state.temperature_overrides[0].scope_id == "Dining"
    assert state.temperature_overrides[0].actor_user_id == "user-1"
    assert state.temperature_overrides[0].actor_name == "Oliver"

    with pytest.raises(ValueError, match="different action"):
        store.record(
            temperature_action(scope_type="group", scope_id="Dining", preset="eco"),
            ACTOR,
            at=NOW + timedelta(minutes=2),
            action_id="request-123",
        )


def test_replay_uses_server_sequence_even_if_the_clock_moves_back(tmp_path):
    store = OverrideStore(tmp_path / "heat-steward-actions.json")
    store.record(temperature_action(preset="eco"), ACTOR, at=NOW)
    latest = store.record(
        temperature_action(preset="comfort"),
        ACTOR,
        at=NOW - timedelta(seconds=1),
    )

    state = store.load(NOW + timedelta(seconds=1))

    assert len(state.temperature_overrides) == 1
    assert state.temperature_overrides[0].preset == "comfort"
    assert state.temperature_overrides[0].sequence == latest.sequence


def test_expired_latest_action_does_not_restore_an_older_action_at_same_scope(tmp_path):
    store = OverrideStore(tmp_path / "heat-steward-actions.json")
    store.record(temperature_action(preset="boost", duration_minutes=240), ACTOR, at=NOW)
    store.record(
        temperature_action(preset="comfort", duration_minutes=30),
        ACTOR,
        at=NOW + timedelta(minutes=1),
    )

    state = store.load(NOW + timedelta(minutes=32))

    assert state.temperature_overrides == []


def test_clearing_one_scope_leaves_other_scopes_available(tmp_path):
    store = OverrideStore(tmp_path / "heat-steward-actions.json")
    store.record(temperature_action(preset="eco", duration_minutes=240), ACTOR, at=NOW)
    store.record(
        temperature_action(
            scope_type="room",
            scope_id="device-dining",
            preset="comfort",
            duration_minutes=60,
        ),
        ACTOR,
        at=NOW + timedelta(minutes=1),
    )
    store.record(
        OverrideActionRequest(
            channel="temperature",
            scope_type="room",
            scope_id="device-dining",
            operation="clear",
        ),
        ACTOR,
        at=NOW + timedelta(minutes=2),
    )

    state = store.load(NOW + timedelta(minutes=3))

    assert [(item.scope_type, item.preset) for item in state.temperature_overrides] == [
        ("house", "eco")
    ]


def test_corrupt_file_uses_last_valid_state_but_refuses_to_overwrite_it(tmp_path):
    path = tmp_path / "heat-steward-actions.json"
    store = OverrideStore(path)
    store.record(temperature_action(), ACTOR, at=NOW)
    path.write_text("not json", encoding="utf-8")

    state = store.load(NOW + timedelta(minutes=1))

    assert state.temperature_overrides[0].preset == "boost"
    assert store.last_error is not None
    with pytest.raises(OSError):
        store.record(temperature_action(preset="eco"), ACTOR, at=NOW + timedelta(minutes=2))
    assert path.read_text(encoding="utf-8") == "not json"


def test_reducer_ignores_future_actions(tmp_path):
    store = OverrideStore(tmp_path / "heat-steward-actions.json")
    store.record(temperature_action(), ACTOR, at=NOW + timedelta(hours=1))

    assert reduce_override_actions(store.load_ledger().actions, NOW).temperature_overrides == []
