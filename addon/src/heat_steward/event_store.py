from __future__ import annotations

import json
import os
import tempfile
from contextlib import suppress
from pathlib import Path
from typing import Any


class EventStore:
    """Small persistent, bounded JSON event history."""

    def __init__(self, path: str | Path, *, maximum_events: int = 500):
        self.path = Path(path)
        self.maximum_events = maximum_events

    def load(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, dict)][-self.maximum_events :]

    def append(self, event: dict[str, Any]) -> None:
        events = self.load()
        events.append(event)
        self._write(events[-self.maximum_events :])

    def _write(self, events: list[dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary_path = tempfile.mkstemp(
            prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(events, handle, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary_path, 0o600)
            os.replace(temporary_path, self.path)
        except Exception:
            with suppress(FileNotFoundError):
                os.unlink(temporary_path)
            raise
