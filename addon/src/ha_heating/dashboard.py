from __future__ import annotations

import math
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from .config import HeatingConfig


def _temperature(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def build_dashboard(config: HeatingConfig, states: list[dict[str, Any]]) -> dict[str, Any]:
    """Build the small, UI-focused live view from configured Home Assistant entities."""
    states_by_entity = {
        state["entity_id"]: state for state in states if isinstance(state.get("entity_id"), str)
    }
    grouped_rooms: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for trv in config.trvs:
        climate = states_by_entity.get(trv.entities.climate, {})
        climate_attributes = climate.get("attributes", {})
        current_entity = trv.external_temperature_sensor

        if current_entity:
            current_state = states_by_entity.get(current_entity, {})
            current_temperature = _temperature(current_state.get("state"))
            unit = current_state.get("attributes", {}).get("unit_of_measurement")
        else:
            current_temperature = _temperature(climate_attributes.get("current_temperature"))
            unit = climate_attributes.get("temperature_unit")
            if current_temperature is None and trv.entities.local_temperature:
                current_entity = trv.entities.local_temperature
                current_state = states_by_entity.get(current_entity, {})
                current_temperature = _temperature(current_state.get("state"))
                unit = current_state.get("attributes", {}).get("unit_of_measurement")

        grouped_rooms[trv.room_group].append(
            {
                "device_id": trv.device_id,
                "name": trv.area_name or trv.name,
                "trv_name": trv.name,
                "climate_entity": trv.entities.climate,
                "current_temperature_entity": current_entity or trv.entities.climate,
                "current_temperature": current_temperature,
                "target_temperature": _temperature(climate_attributes.get("temperature")),
                "unit": unit or climate_attributes.get("temperature_unit") or "°C",
                "available": climate.get("state") not in {None, "unavailable", "unknown"},
            }
        )

    return {
        "updated_at": datetime.now(UTC).isoformat(),
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
