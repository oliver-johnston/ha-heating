from __future__ import annotations

from datetime import datetime
from typing import Any

from .config import HeatingConfig
from .control import HeatingController, build_control_plan


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _available(state: dict[str, Any] | None) -> bool:
    return state is not None and state.get("state") not in {None, "unknown", "unavailable"}


def _switch_state(states: dict[str, dict[str, Any]], entity_id: str | None) -> bool | None:
    if not entity_id:
        return None
    state = states.get(entity_id)
    return state.get("state") == "on" if _available(state) else None


def build_diagnostics(
    config: HeatingConfig,
    states: list[dict[str, Any]],
    controller: HeatingController | None,
    *,
    at: datetime | None = None,
) -> dict[str, Any]:
    """Build a human-readable snapshot of controller and device health."""
    now = at or datetime.now().astimezone()
    status = controller.status if controller else None
    plan = status.plan if status and status.plan else build_control_plan(config, states, now)
    states_by_entity = {
        state["entity_id"]: state for state in states if isinstance(state.get("entity_id"), str)
    }
    issues: list[dict[str, str]] = []

    if status is None or status.last_cycle_finished_at is None:
        loop_status = "starting"
        issues.append(
            {
                "severity": "warning",
                "title": "No completed control cycle",
                "detail": "The controller has not completed a cycle since this add-on started.",
            }
        )
    else:
        age_seconds = max(0, (now - status.last_cycle_finished_at).total_seconds())
        overdue_after = max(60, config.control.cycle_interval_seconds * 2)
        if age_seconds > overdue_after:
            loop_status = "overdue"
            issues.append(
                {
                    "severity": "error",
                    "title": "Control loop is overdue",
                    "detail": (
                        f"The last cycle finished {round(age_seconds)} seconds ago; "
                        f"cycles should run every {config.control.cycle_interval_seconds} seconds."
                    ),
                }
            )
        elif status.last_error:
            loop_status = "error"
        else:
            loop_status = "healthy"

    if status and status.last_error:
        issues.append(
            {
                "severity": "error",
                "title": "Latest control error",
                "detail": status.last_error,
            }
        )

    trvs = {trv.device_id: trv for trv in config.trvs}
    rooms: list[dict[str, Any]] = []
    for decision in plan.rooms:
        trv = trvs[decision.device_id]
        source = "external" if decision.external_temperature is not None else "TRV"
        if not decision.available:
            issues.append(
                {
                    "severity": "error",
                    "title": f"{trv.area_name or trv.name} is unavailable",
                    "detail": (
                        "No usable temperature is available from "
                        f"{decision.current_temperature_entity}."
                    ),
                }
            )
        elif decision.warning:
            issues.append(
                {
                    "severity": "warning",
                    "title": f"{trv.area_name or trv.name} is using its fallback sensor",
                    "detail": decision.warning,
                }
            )
        rooms.append(
            {
                "device_id": decision.device_id,
                "name": trv.area_name or trv.name,
                "room_group": decision.room_group,
                "climate_entity": trv.entities.climate,
                "available": decision.available,
                "status": decision.status,
                "current_temperature": decision.current_temperature,
                "temperature_source": source,
                "temperature_entity": decision.current_temperature_entity,
                "scheduled_temperature": decision.scheduled_temperature,
                "preset": decision.preset,
                "demand": decision.demand,
                "commanded_temperature": decision.commanded_temperature,
                "reported_target_temperature": decision.trv_target_temperature,
                "hvac_mode": decision.hvac_mode,
                "hvac_action": decision.hvac_action,
                "warning": decision.warning,
            }
        )

    boiler_actual = _switch_state(states_by_entity, config.boiler_switch)
    hot_water_actual = _switch_state(states_by_entity, config.hot_water_switch)
    for name, entity_id, requested, actual in (
        ("Central heating", config.boiler_switch, plan.boiler_should_be_on, boiler_actual),
        ("Hot water", config.hot_water_switch, plan.hot_water_should_be_on, hot_water_actual),
    ):
        if entity_id and actual is None:
            issues.append(
                {
                    "severity": "error",
                    "title": f"{name} relay is unavailable",
                    "detail": f"Home Assistant cannot read {entity_id}.",
                }
            )
        elif config.control.enabled and entity_id and requested is not None and requested != actual:
            issues.append(
                {
                    "severity": "warning",
                    "title": f"{name} is waiting to change",
                    "detail": (
                        f"Requested {'on' if requested else 'off'}, but {entity_id} "
                        f"currently reports {'on' if actual else 'off'}. Anti-cycling "
                        "or the next control cycle may account for this."
                    ),
                }
            )

    if any(issue["severity"] == "error" for issue in issues):
        overall_status = "error"
    elif issues:
        overall_status = "warning"
    elif config.control.enabled:
        overall_status = "running"
    else:
        overall_status = "monitoring"

    events = []
    if status:
        events = [
            {
                "occurred_at": event.occurred_at.isoformat(),
                "level": event.level,
                "message": event.message,
            }
            for event in reversed(status.events[-50:])
        ]

    return {
        "updated_at": now.isoformat(),
        "overall_status": overall_status,
        "controller": {
            "enabled": config.control.enabled,
            "loop_status": loop_status,
            "cycle_interval_seconds": config.control.cycle_interval_seconds,
            "last_cycle_started_at": _iso(status.last_cycle_started_at) if status else None,
            "last_cycle_finished_at": _iso(status.last_cycle_finished_at) if status else None,
            "last_successful_cycle_at": _iso(status.last_successful_cycle_at) if status else None,
            "last_error": status.last_error if status else None,
            "latest_actions": list(status.actions) if status else [],
        },
        "plant": {
            "boiler": {
                "configured": config.boiler_switch is not None,
                "entity_id": config.boiler_switch,
                "requested": plan.boiler_should_be_on if config.boiler_switch else None,
                "actual": boiler_actual,
            },
            "hot_water": {
                "configured": config.hot_water_switch is not None,
                "entity_id": config.hot_water_switch,
                "requested": plan.hot_water_should_be_on,
                "actual": hot_water_actual,
            },
        },
        "issues": issues,
        "rooms": sorted(
            rooms, key=lambda room: (room["room_group"].casefold(), room["name"].casefold())
        ),
        "events": events,
    }
