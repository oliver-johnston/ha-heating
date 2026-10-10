from __future__ import annotations

import os
import tempfile
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _validate_entity_id(value: str, domains: set[str], label: str) -> str:
    value = value.strip()
    if "." not in value:
        raise ValueError(f"{label} must be a Home Assistant entity ID")
    domain, object_id = value.split(".", 1)
    if domain not in domains or not object_id:
        allowed = ", ".join(sorted(domains))
        raise ValueError(f"{label} must use one of these domains: {allowed}")
    return value


class TRVEntities(BaseModel):
    model_config = ConfigDict(extra="forbid")

    climate: str
    external_temperature_input: str | None = None
    frost_protection_temperature: str | None = None
    local_temperature_calibration: str | None = None
    temperature_accuracy: str | None = None
    temporary_mode_duration: str | None = None
    timer_mode_target_temperature: str | None = None
    local_temperature: str | None = None
    battery: str | None = None
    last_seen: str | None = None
    child_lock: str | None = None
    smart_temperature_control: str | None = None
    open_window: str | None = None
    temperature_sensor_select: str | None = None
    temporary_mode_select: str | None = None
    valve_opening_degree: str | None = None
    valve_closing_degree: str | None = None
    closing_steps: str | None = None
    idle_steps: str | None = None
    valve_opening_limit_voltage: str | None = None
    valve_closing_limit_voltage: str | None = None
    valve_motor_running_voltage: str | None = None
    linkquality: str | None = None
    firmware_update: str | None = None

    @field_validator("climate")
    @classmethod
    def validate_climate(cls, value: str) -> str:
        return _validate_entity_id(value, {"climate"}, "TRV climate entity")


class ControlledTRV(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    manufacturer: str | None = None
    model: str | None = None
    software_version: str | None = None
    area_name: str | None = None
    room_group: str = Field(min_length=1, max_length=80)
    external_temperature_sensor: str | None = None
    entities: TRVEntities

    @field_validator("device_id", "name", "room_group")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value

    @field_validator("external_temperature_sensor")
    @classmethod
    def validate_external_sensor(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_entity_id(value, {"sensor", "input_number"}, "Temperature sensor")


class HeatingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    boiler_switch: str
    hot_water_switch: str
    trvs: list[ControlledTRV] = Field(min_length=1)

    @field_validator("boiler_switch", "hot_water_switch")
    @classmethod
    def validate_switch(cls, value: str) -> str:
        return _validate_entity_id(value, {"switch"}, "Relay")

    @model_validator(mode="after")
    def validate_unique_assignments(self) -> HeatingConfig:
        if self.boiler_switch == self.hot_water_switch:
            raise ValueError("Boiler and hot-water switches must be different")
        device_ids = [trv.device_id for trv in self.trvs]
        if len(device_ids) != len(set(device_ids)):
            raise ValueError("A TRV device can only be configured once")
        climates = [trv.entities.climate for trv in self.trvs]
        if len(climates) != len(set(climates)):
            raise ValueError("A TRV climate entity can only be configured once")
        return self


class ConfigStore:
    """Atomic, versioned persistence for the user-owned system configuration."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def load(self) -> HeatingConfig | None:
        if not self.path.exists():
            return None
        return HeatingConfig.model_validate_json(self.path.read_text(encoding="utf-8"))

    def save(self, config: HeatingConfig) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = config.model_dump_json(indent=2)
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
