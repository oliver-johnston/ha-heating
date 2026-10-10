from __future__ import annotations

import os
import tempfile
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HeatingMode = Literal["home", "away"]
BoostDuration = Literal[30, 60, 120, 240]


class ModeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: HeatingMode


class BoostUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    room_group: str | None = Field(default=None, max_length=80)
    duration_minutes: BoostDuration

    @field_validator("room_group")
    @classmethod
    def strip_room_group(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Room group must not be blank")
        return value


class HotWaterBoostUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    duration_minutes: BoostDuration


class BoostCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    room_group: str | None = Field(default=None, max_length=80)

    @field_validator("room_group")
    @classmethod
    def strip_room_group(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Room group must not be blank")
        return value


class ActiveBoost(BaseModel):
    model_config = ConfigDict(extra="forbid")

    room_group: str | None = Field(default=None, max_length=80)
    started_at: datetime
    expires_at: datetime

    @field_validator("room_group")
    @classmethod
    def strip_room_group(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Room group must not be blank")
        return value

    @model_validator(mode="after")
    def validate_times(self) -> ActiveBoost:
        if self.started_at.tzinfo is None or self.expires_at.tzinfo is None:
            raise ValueError("Boost timestamps must include a time zone")
        if self.expires_at <= self.started_at:
            raise ValueError("Boost expiry must be after its start")
        return self


class ActiveHotWaterBoost(BaseModel):
    model_config = ConfigDict(extra="forbid")

    started_at: datetime
    expires_at: datetime

    @model_validator(mode="after")
    def validate_times(self) -> ActiveHotWaterBoost:
        if self.started_at.tzinfo is None or self.expires_at.tzinfo is None:
            raise ValueError("Hot-water boost timestamps must include a time zone")
        if self.expires_at <= self.started_at:
            raise ValueError("Hot-water boost expiry must be after its start")
        return self


class OverrideState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: HeatingMode = "home"
    boosts: list[ActiveBoost] = Field(default_factory=list)
    hot_water_boost: ActiveHotWaterBoost | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def validate_unique_targets(self) -> OverrideState:
        targets = [boost.room_group for boost in self.boosts]
        if len(targets) != len(set(targets)):
            raise ValueError("Only one active boost is allowed for each target")
        return self

    def active_at(self, at: datetime) -> OverrideState:
        return self.model_copy(
            update={
                "boosts": [boost for boost in self.boosts if boost.expires_at > at],
                "hot_water_boost": (
                    self.hot_water_boost
                    if self.hot_water_boost and self.hot_water_boost.expires_at > at
                    else None
                ),
            }
        )


class OverrideStore:
    """Atomic persistence for transient Home/Away and boost state."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def load(self) -> OverrideState:
        if not self.path.exists():
            return OverrideState()
        return OverrideState.model_validate_json(self.path.read_text(encoding="utf-8"))

    def save(self, state: OverrideState) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = state.model_dump_json(indent=2)
        fd, temporary_path = tempfile.mkstemp(
            prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary_path, 0o600)
            os.replace(temporary_path, self.path)
        except Exception:
            with suppress(FileNotFoundError):
                os.unlink(temporary_path)
            raise
