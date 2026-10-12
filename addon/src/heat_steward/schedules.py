from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, time, timedelta

from .config import (
    HotWaterPeriod,
    HotWaterSchedule,
    HotWaterState,
    PresetName,
    RoomSchedule,
    SchedulePeriod,
)


def active_room_preset(schedule: RoomSchedule, at: datetime) -> PresetName:
    weekday = at.strftime("%A").lower()
    current = at.strftime("%H:%M")
    for period in schedule.periods:
        if weekday in period.days and period.start <= current < period.end:
            return period.preset
    return schedule.default_preset


def active_hot_water_state(schedule: HotWaterSchedule, at: datetime) -> HotWaterState:
    weekday = at.strftime("%A").lower()
    current = at.strftime("%H:%M")
    for period in schedule.periods:
        if weekday in period.days and period.start <= current < period.end:
            return period.state
    return schedule.default_state


def next_hot_water_state(
    schedule: HotWaterSchedule, at: datetime
) -> tuple[datetime, HotWaterState] | None:
    """Return the next boundary that actually changes the scheduled state."""
    current = active_hot_water_state(schedule, at)
    candidates = _schedule_boundaries(schedule.periods, at)
    for candidate in candidates:
        value = active_hot_water_state(schedule, candidate)
        if value != current:
            return candidate, value
    return None


def next_room_preset(schedule: RoomSchedule, at: datetime) -> tuple[datetime, PresetName] | None:
    """Return the next boundary that actually changes the active preset."""
    current = active_room_preset(schedule, at)
    candidates = _schedule_boundaries(schedule.periods, at)
    for candidate in candidates:
        value = active_room_preset(schedule, candidate)
        if value != current:
            return candidate, value
    return None


def _schedule_boundaries(
    periods: Sequence[SchedulePeriod | HotWaterPeriod], at: datetime
) -> list[datetime]:
    candidates: set[datetime] = set()
    for day_offset in range(8):
        date = (at + timedelta(days=day_offset)).date()
        weekday = date.strftime("%A").lower()
        for period in periods:
            if weekday not in period.days:
                continue
            for value in (period.start, period.end):
                hours, minutes = (int(part) for part in value.split(":"))
                candidate = datetime.combine(
                    date, time(hour=hours, minute=minutes), tzinfo=at.tzinfo
                )
                if candidate > at:
                    candidates.add(candidate)
    return sorted(candidates)
