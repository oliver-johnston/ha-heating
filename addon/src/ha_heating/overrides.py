from __future__ import annotations

import json
import os
import tempfile
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .config import PresetName

HeatingMode = Literal["home", "away"]
BoostDuration = Literal[30, 60, 120, 240]
OverrideChannel = Literal["temperature", "occupancy", "hot_water"]
OverrideScope = Literal["house", "group", "room", "hot_water"]
OverrideOperation = Literal["set", "clear"]
OverrideValueMode = Literal["preset", "temperature", "mode", "on_off"]


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


class OverrideActor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(min_length=1, max_length=80)
    user_id: str | None = Field(default=None, max_length=128)
    name: str | None = Field(default=None, max_length=160)


class OverrideActionRequest(BaseModel):
    """Validated command accepted by every override entry point."""

    model_config = ConfigDict(extra="forbid")

    channel: OverrideChannel
    scope_type: OverrideScope
    scope_id: str | None = Field(default=None, max_length=128)
    operation: OverrideOperation = "set"
    override_mode: OverrideValueMode | None = None
    override_preset: PresetName | None = None
    override_temperature: float | None = Field(default=None, ge=5, le=30)
    mode: HeatingMode | None = None
    on_off: bool | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=10_080)

    @field_validator("scope_id")
    @classmethod
    def strip_scope_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Override scope must not be blank")
        return value

    @model_validator(mode="after")
    def validate_shape(self) -> OverrideActionRequest:
        _validate_action_shape(self)
        return self


class OverrideAction(BaseModel):
    """One immutable fact in the persistent override ledger."""

    model_config = ConfigDict(extra="forbid")

    sequence: int = Field(ge=1)
    action_id: str = Field(min_length=1, max_length=64)
    initiated_at: datetime
    recorded_at: datetime
    expires_at: datetime | None = None
    duration_seconds: int | None = Field(default=None, ge=1)
    channel: OverrideChannel
    scope_type: OverrideScope
    scope_id: str | None = Field(default=None, max_length=128)
    operation: OverrideOperation
    override_mode: OverrideValueMode | None = None
    override_preset: PresetName | None = None
    override_temperature: float | None = Field(default=None, ge=5, le=30)
    mode: HeatingMode | None = None
    on_off: bool | None = None
    actor_user_id: str | None = Field(default=None, max_length=128)
    actor_name: str | None = Field(default=None, max_length=160)
    source: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def validate_action(self) -> OverrideAction:
        for value in (self.initiated_at, self.recorded_at, self.expires_at):
            if value is not None and value.tzinfo is None:
                raise ValueError("Override timestamps must include a time zone")
        if self.expires_at is not None and self.expires_at <= self.initiated_at:
            raise ValueError("Override expiry must be after its start")
        if (self.expires_at is None) != (self.duration_seconds is None):
            raise ValueError(
                "Override duration and expiry must either both be set or both be absent"
            )
        _validate_action_shape(self)
        return self

    @property
    def key(self) -> tuple[str, str, str | None]:
        return self.channel, self.scope_type, self.scope_id

    def is_active_at(self, at: datetime) -> bool:
        return (
            self.operation == "set"
            and self.initiated_at <= at
            and (self.expires_at is None or self.expires_at > at)
        )


def _validate_action_shape(action: OverrideActionRequest | OverrideAction) -> None:
    if action.scope_type in {"group", "room"}:
        if action.scope_id is None:
            raise ValueError("Group and room overrides require a scope ID")
    elif action.scope_id is not None:
        raise ValueError("House and hot-water overrides must not have a scope ID")

    if action.channel == "temperature" and action.scope_type not in {"house", "group", "room"}:
        raise ValueError("Temperature overrides must target the house, a group, or a room")
    if action.channel == "occupancy" and action.scope_type != "house":
        raise ValueError("Occupancy actions must target the whole house")
    if action.channel == "hot_water" and action.scope_type != "hot_water":
        raise ValueError("Hot-water actions must target hot water")

    if action.operation == "clear":
        values = (
            action.override_mode,
            action.override_preset,
            action.override_temperature,
            action.mode,
            action.on_off,
        )
        if any(value is not None for value in values):
            raise ValueError("Clear actions must not contain an override value")
        duration = (
            action.duration_minutes
            if isinstance(action, OverrideActionRequest)
            else action.duration_seconds
        )
        if duration is not None:
            raise ValueError("Clear actions must not have a duration")
        return

    if action.channel == "temperature":
        if action.override_mode == "preset":
            if action.override_preset is None or action.override_temperature is not None:
                raise ValueError("Preset overrides require exactly one preset")
        elif action.override_mode == "temperature":
            if action.override_temperature is None or action.override_preset is not None:
                raise ValueError("Temperature overrides require exactly one temperature")
        else:
            raise ValueError("Temperature overrides must use preset or temperature mode")
        if action.mode is not None or action.on_off is not None:
            raise ValueError("Temperature overrides contain an incompatible value")
    elif action.channel == "occupancy":
        if action.override_mode != "mode" or action.mode is None:
            raise ValueError("Occupancy actions must set Home or Away for the whole house")
        if (
            action.override_preset is not None
            or action.override_temperature is not None
            or action.on_off is not None
        ):
            raise ValueError("Occupancy actions contain an incompatible value")
        duration = (
            action.duration_minutes
            if isinstance(action, OverrideActionRequest)
            else action.duration_seconds
        )
        if duration is not None:
            raise ValueError("Home and Away actions do not expire")
    else:
        if action.override_mode != "on_off":
            raise ValueError("Hot-water actions must target hot water and set On or Off")
        if action.on_off is None:
            raise ValueError("Hot-water actions require an On or Off value")
        if (
            action.override_preset is not None
            or action.override_temperature is not None
            or action.mode is not None
        ):
            raise ValueError("Hot-water actions contain an incompatible value")


class ActionLedger(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    next_sequence: int = Field(default=1, ge=1)
    actions: list[OverrideAction] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def validate_sequences(self) -> ActionLedger:
        sequences = [action.sequence for action in self.actions]
        action_ids = [action.action_id for action in self.actions]
        if len(sequences) != len(set(sequences)):
            raise ValueError("Override action sequences must be unique")
        if len(action_ids) != len(set(action_ids)):
            raise ValueError("Override action IDs must be unique")
        if sequences and self.next_sequence <= max(sequences):
            raise ValueError("The next override sequence must follow all recorded actions")
        self.actions.sort(key=lambda action: action.sequence)
        return self


class ActiveTemperatureOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: int = 0
    action_id: str = "legacy"
    scope_type: Literal["house", "group", "room"]
    scope_id: str | None = None
    override_mode: Literal["preset", "temperature"]
    preset: PresetName | None = None
    temperature: float | None = None
    started_at: datetime
    expires_at: datetime | None = None
    actor_user_id: str | None = None
    actor_name: str | None = None
    source: str = "legacy"


class ActiveHotWaterOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: int = 0
    action_id: str = "legacy"
    on: bool
    started_at: datetime
    expires_at: datetime | None = None
    actor_user_id: str | None = None
    actor_name: str | None = None
    source: str = "legacy"


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
    temperature_overrides: list[ActiveTemperatureOverride] = Field(default_factory=list)
    hot_water_override: ActiveHotWaterOverride | None = None
    boosts: list[ActiveBoost] = Field(default_factory=list)
    hot_water_boost: ActiveHotWaterBoost | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def add_compatibility_views(self) -> OverrideState:
        if self.boosts and not self.temperature_overrides:
            self.temperature_overrides = [
                ActiveTemperatureOverride(
                    scope_type="house" if boost.room_group is None else "group",
                    scope_id=boost.room_group,
                    override_mode="preset",
                    preset="boost",
                    started_at=boost.started_at,
                    expires_at=boost.expires_at,
                )
                for boost in self.boosts
            ]
        if self.hot_water_boost is not None and self.hot_water_override is None:
            self.hot_water_override = ActiveHotWaterOverride(
                on=True,
                started_at=self.hot_water_boost.started_at,
                expires_at=self.hot_water_boost.expires_at,
            )
        if not self.boosts:
            self.boosts = [
                ActiveBoost(
                    room_group=(override.scope_id if override.scope_type == "group" else None),
                    started_at=override.started_at,
                    expires_at=override.expires_at,
                )
                for override in self.temperature_overrides
                if override.override_mode == "preset"
                and override.preset == "boost"
                and override.scope_type in {"house", "group"}
                and override.expires_at is not None
            ]
        if (
            self.hot_water_boost is None
            and self.hot_water_override is not None
            and self.hot_water_override.on
            and self.hot_water_override.expires_at is not None
        ):
            self.hot_water_boost = ActiveHotWaterBoost(
                started_at=self.hot_water_override.started_at,
                expires_at=self.hot_water_override.expires_at,
            )
        return self

    def active_at(self, at: datetime) -> OverrideState:
        return OverrideState(
            mode=self.mode,
            temperature_overrides=[
                override
                for override in self.temperature_overrides
                if override.expires_at is None or override.expires_at > at
            ],
            hot_water_override=(
                self.hot_water_override
                if self.hot_water_override is not None
                and (
                    self.hot_water_override.expires_at is None
                    or self.hot_water_override.expires_at > at
                )
                else None
            ),
            updated_at=self.updated_at,
        )


def reduce_override_actions(actions: list[OverrideAction], at: datetime) -> OverrideState:
    """Reduce immutable actions to the effective state at one instant."""
    latest: dict[tuple[str, str, str | None], OverrideAction] = {}
    for action in sorted(actions, key=lambda item: item.sequence):
        if action.initiated_at <= at:
            latest[action.key] = action

    mode: HeatingMode = "home"
    temperature_overrides: list[ActiveTemperatureOverride] = []
    hot_water_override: ActiveHotWaterOverride | None = None
    updated_at = datetime.fromtimestamp(0, UTC)
    for action in latest.values():
        updated_at = max(updated_at, action.recorded_at)
        if not action.is_active_at(at):
            continue
        if action.channel == "occupancy":
            mode = action.mode or "home"
        elif action.channel == "temperature":
            temperature_overrides.append(
                ActiveTemperatureOverride(
                    sequence=action.sequence,
                    action_id=action.action_id,
                    scope_type=action.scope_type,
                    scope_id=action.scope_id,
                    override_mode=action.override_mode,
                    preset=action.override_preset,
                    temperature=action.override_temperature,
                    started_at=action.initiated_at,
                    expires_at=action.expires_at,
                    actor_user_id=action.actor_user_id,
                    actor_name=action.actor_name,
                    source=action.source,
                )
            )
        elif action.channel == "hot_water":
            hot_water_override = ActiveHotWaterOverride(
                sequence=action.sequence,
                action_id=action.action_id,
                on=bool(action.on_off),
                started_at=action.initiated_at,
                expires_at=action.expires_at,
                actor_user_id=action.actor_user_id,
                actor_name=action.actor_name,
                source=action.source,
            )
    return OverrideState(
        mode=mode,
        temperature_overrides=sorted(
            temperature_overrides, key=lambda override: override.sequence
        ),
        hot_water_override=hot_water_override,
        updated_at=updated_at,
    )


class OverrideStore:
    """Atomic, versioned persistence for the immutable override action ledger."""

    def __init__(self, path: str | Path, *, maximum_actions: int = 2000):
        self.path = Path(path)
        self.maximum_actions = maximum_actions
        self.last_error: str | None = None
        self._cached = ActionLedger()

    def load_ledger(self, *, strict: bool = False) -> ActionLedger:
        if not self.path.exists():
            self.last_error = None
            self._cached = ActionLedger()
            return self._cached.model_copy(deep=True)
        try:
            ledger = ActionLedger.model_validate_json(self.path.read_text(encoding="utf-8"))
        except (OSError, ValidationError, json.JSONDecodeError) as exc:
            self.last_error = f"Could not read override actions: {exc}"
            if strict:
                raise OSError(self.last_error) from exc
            return self._cached.model_copy(deep=True)
        self.last_error = None
        self._cached = ledger
        return ledger.model_copy(deep=True)

    def load(self, at: datetime | None = None) -> OverrideState:
        return reduce_override_actions(
            self.load_ledger().actions,
            at or datetime.now().astimezone(),
        )

    def record(
        self,
        request: OverrideActionRequest,
        actor: OverrideActor,
        *,
        at: datetime | None = None,
        action_id: str | None = None,
    ) -> OverrideAction:
        now = at or datetime.now().astimezone()
        ledger = self.load_ledger(strict=True)
        if action_id is not None:
            existing = next(
                (action for action in ledger.actions if action.action_id == action_id), None
            )
            if existing is not None:
                duration_seconds = (
                    request.duration_minutes * 60
                    if request.duration_minutes is not None
                    else None
                )
                if (
                    existing.channel != request.channel
                    or existing.scope_type != request.scope_type
                    or existing.scope_id != request.scope_id
                    or existing.operation != request.operation
                    or existing.override_mode != request.override_mode
                    or existing.override_preset != request.override_preset
                    or existing.override_temperature != request.override_temperature
                    or existing.mode != request.mode
                    or existing.on_off != request.on_off
                    or existing.duration_seconds != duration_seconds
                ):
                    raise ValueError("Idempotency key was already used for a different action")
                return existing
        duration_seconds = (
            request.duration_minutes * 60 if request.duration_minutes is not None else None
        )
        action = OverrideAction(
            sequence=ledger.next_sequence,
            action_id=action_id or str(uuid4()),
            initiated_at=now,
            recorded_at=datetime.now(UTC),
            expires_at=(now + timedelta(seconds=duration_seconds) if duration_seconds else None),
            duration_seconds=duration_seconds,
            channel=request.channel,
            scope_type=request.scope_type,
            scope_id=request.scope_id,
            operation=request.operation,
            override_mode=request.override_mode,
            override_preset=request.override_preset,
            override_temperature=request.override_temperature,
            mode=request.mode,
            on_off=request.on_off,
            actor_user_id=actor.user_id,
            actor_name=actor.name,
            source=actor.source,
        )
        ledger.actions.append(action)
        ledger.next_sequence += 1
        ledger.updated_at = datetime.now(UTC)
        ledger.actions = self._compact(ledger.actions)
        self._write(ledger)
        self._cached = ledger
        self.last_error = None
        return action

    def _compact(self, actions: list[OverrideAction]) -> list[OverrideAction]:
        if len(actions) <= self.maximum_actions:
            return actions
        recent = actions[-self.maximum_actions :]
        latest_by_key: dict[tuple[str, str, str | None], OverrideAction] = {}
        for action in actions:
            latest_by_key[action.key] = action
        retained_ids = {action.action_id for action in recent}
        retained_ids.update(action.action_id for action in latest_by_key.values())
        return [action for action in actions if action.action_id in retained_ids]

    def _write(self, ledger: ActionLedger) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = ledger.model_dump_json(indent=2)
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

        self._cached = ledger
        self.last_error = None
