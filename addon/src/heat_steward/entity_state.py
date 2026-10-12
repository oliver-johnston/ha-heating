from __future__ import annotations

import math
from datetime import datetime
from typing import Any


def temperature(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def is_available(state: dict[str, Any] | None) -> bool:
    return state is not None and state.get("state") not in {None, "unknown", "unavailable"}


def state_age_seconds(state: dict[str, Any] | None, now: datetime) -> float | None:
    value = state.get("last_changed") if state else None
    if not isinstance(value, str):
        return None
    try:
        changed_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if changed_at.tzinfo is None:
        return None
    return max(0.0, (now - changed_at.astimezone(now.tzinfo)).total_seconds())


def reported_age_seconds(state: dict[str, Any] | None, now: datetime) -> float | None:
    return datetime_age_seconds(reported_timestamp(state), now)


def reported_timestamp(state: dict[str, Any] | None) -> datetime | None:
    if not state:
        return None
    for key in ("last_reported", "last_updated"):
        value = state.get(key)
        if not isinstance(value, str):
            continue
        try:
            reported_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            continue
        if reported_at.tzinfo is not None:
            return reported_at
    return None


def datetime_age_seconds(value: datetime | None, now: datetime) -> float | None:
    if value is None:
        return None
    return max(0.0, (now - value.astimezone(now.tzinfo)).total_seconds())


def timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def timestamp_age_seconds(value: Any, now: datetime) -> float | None:
    return datetime_age_seconds(timestamp(value), now)


def inferred_last_seen_entity(entity_id: str, states: dict[str, dict[str, Any]]) -> str | None:
    domain, _, object_id = entity_id.partition(".")
    if domain != "sensor" or not object_id.endswith("_temperature"):
        return None
    candidate = f"sensor.{object_id.removesuffix('_temperature')}_last_seen"
    return candidate if candidate in states else None


def external_freshness(
    trv: Any,
    states: dict[str, dict[str, Any]],
    temperature_state: dict[str, Any] | None,
    now: datetime,
) -> tuple[str, str | None, datetime | None, float | None]:
    mode = trv.external_temperature_freshness
    health_entity = trv.external_temperature_last_seen
    if mode == "disabled":
        return mode, None, None, None
    if mode == "auto":
        health_entity = health_entity or inferred_last_seen_entity(
            trv.external_temperature_sensor, states
        )
        mode = "last_seen" if health_entity else "state_updates"
    if mode == "last_seen" and health_entity:
        health_state = states.get(health_entity)
        health_timestamp = timestamp(health_state.get("state") if health_state else None)
        return (
            mode,
            health_entity,
            health_timestamp,
            datetime_age_seconds(health_timestamp, now),
        )
    health_timestamp = reported_timestamp(temperature_state)
    return (
        "state_updates",
        trv.external_temperature_sensor,
        health_timestamp,
        datetime_age_seconds(health_timestamp, now),
    )
