from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from .config import HeatingConfig
from .control import ControlPlan, build_control_plan
from .overrides import OverrideState


def build_dashboard(
    config: HeatingConfig,
    states: list[dict[str, Any]],
    *,
    plan: ControlPlan | None = None,
    at: datetime | None = None,
    controller_error: str | None = None,
    overrides: OverrideState | None = None,
) -> dict[str, Any]:
    """Build the UI-focused live view from configuration, decisions, and HA state."""
    now = at or datetime.now().astimezone()
    overrides = (overrides or OverrideState()).active_at(now)
    plan = plan or build_control_plan(config, states, now, overrides=overrides)
    decisions = {decision.device_id: decision for decision in plan.rooms}
    grouped_rooms: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for trv in config.trvs:
        decision = decisions.get(trv.device_id)
        if decision is None:
            continue
        grouped_rooms[trv.room_group].append(
            {
                "device_id": trv.device_id,
                "room_group": trv.room_group,
                "name": trv.area_name or trv.name,
                "trv_name": trv.name,
                "climate_entity": trv.entities.climate,
                "current_temperature_entity": decision.current_temperature_entity,
                "current_temperature": decision.current_temperature,
                "external_temperature": decision.external_temperature,
                "trv_temperature": decision.trv_temperature,
                "target_temperature": decision.trv_target_temperature,
                "scheduled_temperature": decision.scheduled_temperature,
                "commanded_temperature": decision.commanded_temperature,
                "preset": decision.preset,
                "demand": decision.demand,
                "status": decision.status,
                "hvac_mode": decision.hvac_mode,
                "hvac_action": decision.hvac_action,
                "warning": decision.warning,
                "external_temperature_freshness": decision.external_temperature_freshness,
                "external_temperature_health_entity": decision.external_temperature_health_entity,
                "external_temperature_last_seen_at": (
                    decision.external_temperature_last_seen_at.isoformat()
                    if decision.external_temperature_last_seen_at
                    else None
                ),
                "external_temperature_age_seconds": decision.external_temperature_age_seconds,
                "external_temperature_stale_after_seconds": (
                    decision.external_temperature_stale_after_seconds
                ),
                "trv_last_seen_at": (
                    decision.trv_last_seen_at.isoformat() if decision.trv_last_seen_at else None
                ),
                "next_schedule_at": (
                    decision.next_schedule_at.isoformat() if decision.next_schedule_at else None
                ),
                "next_preset": decision.next_preset,
                "next_scheduled_temperature": decision.next_scheduled_temperature,
                "unit": "°C",
                "available": decision.available,
                "control_source": decision.control_source,
                "override_until": (
                    decision.override_until.isoformat() if decision.override_until else None
                ),
                "override_mode": decision.override_mode,
                "override_scope_type": decision.override_scope_type,
                "override_scope_id": decision.override_scope_id,
            }
        )

    return {
        "updated_at": datetime.now().astimezone().isoformat(),
        "controller": {
            "enabled": config.control.enabled,
            "last_error": controller_error,
            "heat_requests": plan.heat_requests,
            "minimum_heat_requests": config.minimum_heat_requests,
            "boiler_should_be_on": plan.boiler_should_be_on,
            "boiler_is_on": plan.boiler_is_on,
            "hot_water_should_be_on": plan.hot_water_should_be_on,
            "hot_water_is_on": plan.hot_water_is_on,
            "hot_water_next_change_at": (
                plan.hot_water_next_change_at.isoformat() if plan.hot_water_next_change_at else None
            ),
            "hot_water_next_state": plan.hot_water_next_state,
        },
        "overrides": {
            **overrides.model_dump(mode="json"),
            "away_preset": config.control.away_preset,
        },
        "groups": [
            {
                "name": group_name,
                "rooms": sorted(rooms, key=lambda room: room["name"].casefold()),
            }
            for group_name, rooms in sorted(
                grouped_rooms.items(), key=lambda item: item[0].casefold()
            )
        ],
    }
