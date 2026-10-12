from __future__ import annotations

import logging
from datetime import datetime

from .controller_status import ControlEvent, ControllerStatus
from .event_store import EventStore

log = logging.getLogger(__name__)


class EventRecorder:
    """Maintain the bounded in-memory event view and its persistent history."""

    def __init__(self, store: EventStore, status: ControllerStatus) -> None:
        self._store = store
        self._status = status
        self._load()

    def record(self, level: str, message: str) -> None:
        event = ControlEvent(
            occurred_at=datetime.now().astimezone(),
            level=level,
            message=message,
        )
        if (
            self._status.events
            and self._status.events[-1].level == level
            and self._status.events[-1].message == message
        ):
            self._status.events[-1] = event
            return
        self._status.events.append(event)
        del self._status.events[:-100]
        try:
            self._store.append(
                {
                    "occurred_at": event.occurred_at.isoformat(),
                    "level": event.level,
                    "message": event.message,
                }
            )
        except OSError as exc:
            log.warning("Could not persist heating event history: %s", exc)

    def _load(self) -> None:
        for item in self._store.load()[-100:]:
            try:
                occurred_at = datetime.fromisoformat(str(item["occurred_at"]))
                level = str(item["level"])
                message = str(item["message"])
            except (KeyError, TypeError, ValueError):
                continue
            if level in {"info", "warning", "error"}:
                self._status.events.append(
                    ControlEvent(occurred_at=occurred_at, level=level, message=message)
                )
