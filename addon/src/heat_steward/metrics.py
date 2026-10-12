from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
DEFAULT_RETENTION_DAYS = 90
PRUNE_INTERVAL = timedelta(hours=24)


def _milliseconds(value: datetime | None) -> int | None:
    if value is None:
        return None
    if value.tzinfo is None:
        raise ValueError("Metrics timestamps must include a time zone")
    return round(value.astimezone(UTC).timestamp() * 1000)


def _iso_from_milliseconds(value: int | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat()


def _boolean(value: bool | None) -> int | None:
    return None if value is None else int(value)


@dataclass
class CycleCommandResults:
    """Commands attempted while applying one control plan.

    Missing dictionary entries mean no command was required. A present value is
    the confirmation result for the command that was sent.
    """

    room_temperature: dict[str, bool] = field(default_factory=dict)
    room_mode: dict[str, bool] = field(default_factory=dict)
    boiler: bool | None = None
    hot_water: bool | None = None


@dataclass(frozen=True)
class MetricsHealth:
    healthy: bool
    schema_version: int | None
    retention_days: int
    cycle_count: int
    room_sample_count: int
    oldest_sample_at: str | None
    latest_sample_at: str | None
    database_size_bytes: int
    last_successful_write_at: str | None
    consecutive_failures: int
    last_error: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "healthy": self.healthy,
            "schema_version": self.schema_version,
            "retention_days": self.retention_days,
            "cycle_count": self.cycle_count,
            "room_sample_count": self.room_sample_count,
            "oldest_sample_at": self.oldest_sample_at,
            "latest_sample_at": self.latest_sample_at,
            "database_size_bytes": self.database_size_bytes,
            "last_successful_write_at": self.last_successful_write_at,
            "consecutive_failures": self.consecutive_failures,
            "last_error": self.last_error,
        }


class MetricsStore:
    """Append-only control history with versioned SQLite migrations."""

    def __init__(
        self,
        path: str | Path,
        *,
        retention_days: int = DEFAULT_RETENTION_DAYS,
        prune_interval: timedelta = PRUNE_INTERVAL,
    ):
        if retention_days < 1:
            raise ValueError("Metrics retention must be at least one day")
        self.path = Path(path)
        self.retention_days = retention_days
        self.prune_interval = prune_interval
        self._state_lock = threading.Lock()
        self._initialization_lock = threading.Lock()
        self._last_pruned_at: datetime | None = None
        self._last_successful_write_at: datetime | None = None
        self._last_error: str | None = None
        self._consecutive_failures = 0

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5)
        try:
            connection.row_factory = sqlite3.Row
            with self._initialization_lock:
                connection.execute("PRAGMA foreign_keys = ON")
                connection.execute("PRAGMA journal_mode = WAL")
                connection.execute("PRAGMA synchronous = NORMAL")
                self._migrate(connection)
                with suppress(OSError):
                    os.chmod(self.path, 0o600)
        except Exception:
            connection.close()
            raise
        return connection

    @staticmethod
    def _migrate(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at_ms INTEGER NOT NULL
            )
            """
        )
        row = connection.execute(
            "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
        ).fetchone()
        current = int(row["version"])
        if current > SCHEMA_VERSION:
            raise RuntimeError(
                f"Metrics database schema {current} is newer than supported schema {SCHEMA_VERSION}"
            )
        if current < 1:
            with connection:
                connection.execute(
                    """
                    CREATE TABLE control_cycles (
                        id INTEGER PRIMARY KEY,
                        recorded_at_ms INTEGER NOT NULL,
                        generated_at_ms INTEGER NOT NULL,
                        cycle_started_at_ms INTEGER,
                        cycle_finished_at_ms INTEGER,
                        duration_ms INTEGER,
                        heating_mode TEXT NOT NULL,
                        control_enabled INTEGER NOT NULL,
                        cycle_interval_seconds INTEGER NOT NULL,
                        hysteresis REAL NOT NULL,
                        heating_offset REAL NOT NULL,
                        idle_offset REAL NOT NULL,
                        cycle_successful INTEGER NOT NULL,
                        control_error TEXT,
                        fault_latched INTEGER NOT NULL,
                        fault_reason TEXT,
                        heat_requests INTEGER NOT NULL,
                        minimum_heat_requests INTEGER NOT NULL,
                        room_count INTEGER NOT NULL,
                        warning_count INTEGER NOT NULL,
                        boiler_configured INTEGER NOT NULL,
                        boiler_requested INTEGER NOT NULL,
                        boiler_actual INTEGER,
                        boiler_command_sent INTEGER NOT NULL,
                        boiler_command_succeeded INTEGER,
                        hot_water_configured INTEGER NOT NULL,
                        hot_water_requested INTEGER,
                        hot_water_actual INTEGER,
                        hot_water_command_sent INTEGER NOT NULL,
                        hot_water_command_succeeded INTEGER,
                        hot_water_next_change_at_ms INTEGER,
                        hot_water_next_state TEXT,
                        actions_json TEXT NOT NULL,
                        app_version TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE room_samples (
                        id INTEGER PRIMARY KEY,
                        cycle_id INTEGER NOT NULL REFERENCES control_cycles(id) ON DELETE CASCADE,
                        observed_at_ms INTEGER NOT NULL,
                        device_id TEXT NOT NULL,
                        room_name TEXT NOT NULL,
                        room_group TEXT NOT NULL,
                        climate_entity TEXT NOT NULL,
                        available INTEGER NOT NULL,
                        status TEXT NOT NULL,
                        current_temperature REAL,
                        temperature_source TEXT NOT NULL,
                        current_temperature_entity TEXT NOT NULL,
                        external_temperature REAL,
                        trv_temperature REAL,
                        external_temperature_freshness TEXT,
                        external_temperature_age_seconds REAL,
                        external_temperature_stale_after_seconds INTEGER,
                        trv_last_seen_at_ms INTEGER,
                        schedule_preset TEXT NOT NULL,
                        schedule_temperature REAL NOT NULL,
                        effective_preset TEXT NOT NULL,
                        effective_target_temperature REAL NOT NULL,
                        control_source TEXT NOT NULL,
                        commanded_temperature REAL NOT NULL,
                        reported_target_temperature REAL,
                        demand INTEGER NOT NULL,
                        hvac_mode TEXT,
                        hvac_action TEXT,
                        valve_opening_degree REAL,
                        valve_closing_degree REAL,
                        battery_level REAL,
                        linkquality REAL,
                        temperature_command_sent INTEGER NOT NULL,
                        temperature_command_succeeded INTEGER,
                        mode_command_sent INTEGER NOT NULL,
                        mode_command_succeeded INTEGER,
                        override_until_ms INTEGER,
                        override_mode TEXT,
                        override_scope_type TEXT,
                        override_scope_id TEXT,
                        next_schedule_at_ms INTEGER,
                        next_preset TEXT,
                        next_scheduled_temperature REAL,
                        warning TEXT,
                        UNIQUE(cycle_id, device_id)
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX room_samples_device_time "
                    "ON room_samples(device_id, observed_at_ms)"
                )
                connection.execute(
                    "CREATE INDEX control_cycles_recorded_at ON control_cycles(recorded_at_ms)"
                )
                connection.execute(
                    "INSERT INTO schema_migrations(version, applied_at_ms) VALUES (?, ?)",
                    (1, _milliseconds(datetime.now(UTC))),
                )

    def record_cycle(
        self,
        *,
        config: Any,
        plan: Any,
        heating_mode: str,
        commands: CycleCommandResults,
        cycle_started_at: datetime | None,
        cycle_finished_at: datetime,
        cycle_successful: bool,
        control_error: str | None,
        fault_latched: bool,
        fault_reason: str | None,
        app_version: str,
        actions: tuple[str, ...],
    ) -> None:
        try:
            self._record_cycle(
                config=config,
                plan=plan,
                heating_mode=heating_mode,
                commands=commands,
                cycle_started_at=cycle_started_at,
                cycle_finished_at=cycle_finished_at,
                cycle_successful=cycle_successful,
                control_error=control_error,
                fault_latched=fault_latched,
                fault_reason=fault_reason,
                app_version=app_version,
                actions=actions,
            )
        except Exception as exc:
            self._mark_failure(exc)
            raise
        with self._state_lock:
            self._last_successful_write_at = cycle_finished_at.astimezone(UTC)
            self._last_error = None
            self._consecutive_failures = 0

    def _record_cycle(
        self,
        *,
        config: Any,
        plan: Any,
        heating_mode: str,
        commands: CycleCommandResults,
        cycle_started_at: datetime | None,
        cycle_finished_at: datetime,
        cycle_successful: bool,
        control_error: str | None,
        fault_latched: bool,
        fault_reason: str | None,
        app_version: str,
        actions: tuple[str, ...],
    ) -> None:
        recorded_at_ms = _milliseconds(cycle_finished_at)
        generated_at_ms = _milliseconds(plan.generated_at)
        started_at_ms = _milliseconds(cycle_started_at)
        duration_ms = (
            max(0, round((cycle_finished_at - cycle_started_at).total_seconds() * 1000))
            if cycle_started_at
            else None
        )
        trvs = {trv.device_id: trv for trv in config.trvs}
        should_prune = (
            self._last_pruned_at is None
            or cycle_finished_at.astimezone(UTC) - self._last_pruned_at >= self.prune_interval
        )

        with self._connect() as connection:
            cycle = connection.execute(
                """
                INSERT INTO control_cycles (
                    recorded_at_ms, generated_at_ms, cycle_started_at_ms,
                    cycle_finished_at_ms, duration_ms, heating_mode, control_enabled,
                    cycle_interval_seconds, hysteresis, heating_offset, idle_offset,
                    cycle_successful, control_error, fault_latched, fault_reason,
                    heat_requests, minimum_heat_requests, room_count, warning_count,
                    boiler_configured, boiler_requested, boiler_actual,
                    boiler_command_sent, boiler_command_succeeded,
                    hot_water_configured, hot_water_requested, hot_water_actual,
                    hot_water_command_sent, hot_water_command_succeeded,
                    hot_water_next_change_at_ms, hot_water_next_state,
                    actions_json, app_version
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?
                )
                """,
                (
                    recorded_at_ms,
                    generated_at_ms,
                    started_at_ms,
                    recorded_at_ms,
                    duration_ms,
                    heating_mode,
                    _boolean(config.control.enabled),
                    config.control.cycle_interval_seconds,
                    config.control.hysteresis,
                    config.control.heating_offset,
                    config.control.idle_offset,
                    _boolean(cycle_successful),
                    control_error,
                    _boolean(fault_latched),
                    fault_reason,
                    plan.heat_requests,
                    config.minimum_heat_requests,
                    len(plan.rooms),
                    sum(room.warning is not None for room in plan.rooms),
                    _boolean(config.boiler_switch is not None),
                    _boolean(plan.boiler_should_be_on),
                    _boolean(plan.boiler_is_on),
                    _boolean(commands.boiler is not None),
                    _boolean(commands.boiler),
                    _boolean(config.hot_water_switch is not None),
                    _boolean(plan.hot_water_should_be_on),
                    _boolean(plan.hot_water_is_on),
                    _boolean(commands.hot_water is not None),
                    _boolean(commands.hot_water),
                    _milliseconds(plan.hot_water_next_change_at),
                    plan.hot_water_next_state,
                    json.dumps(actions, ensure_ascii=False, separators=(",", ":")),
                    app_version,
                ),
            )
            cycle_id = int(cycle.lastrowid)
            for room in plan.rooms:
                trv = trvs[room.device_id]
                temperature_result = commands.room_temperature.get(room.device_id)
                mode_result = commands.room_mode.get(room.device_id)
                connection.execute(
                    """
                    INSERT INTO room_samples (
                        cycle_id, observed_at_ms, device_id, room_name, room_group,
                        climate_entity, available, status, current_temperature,
                        temperature_source, current_temperature_entity,
                        external_temperature, trv_temperature,
                        external_temperature_freshness, external_temperature_age_seconds,
                        external_temperature_stale_after_seconds, trv_last_seen_at_ms,
                        schedule_preset, schedule_temperature, effective_preset,
                        effective_target_temperature, control_source, commanded_temperature,
                        reported_target_temperature, demand, hvac_mode, hvac_action,
                        valve_opening_degree, valve_closing_degree, battery_level, linkquality,
                        temperature_command_sent, temperature_command_succeeded,
                        mode_command_sent, mode_command_succeeded, override_until_ms,
                        override_mode, override_scope_type, override_scope_id,
                        next_schedule_at_ms, next_preset, next_scheduled_temperature, warning
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?
                    )
                    """,
                    (
                        cycle_id,
                        generated_at_ms,
                        room.device_id,
                        trv.area_name or trv.name,
                        room.room_group,
                        trv.entities.climate,
                        _boolean(room.available),
                        room.status,
                        room.current_temperature,
                        "external" if room.external_temperature is not None else "trv",
                        room.current_temperature_entity,
                        room.external_temperature,
                        room.trv_temperature,
                        room.external_temperature_freshness,
                        room.external_temperature_age_seconds,
                        room.external_temperature_stale_after_seconds,
                        _milliseconds(room.trv_last_seen_at),
                        room.schedule_preset,
                        room.schedule_temperature,
                        room.preset,
                        room.scheduled_temperature,
                        room.control_source,
                        room.commanded_temperature,
                        room.trv_target_temperature,
                        _boolean(room.demand),
                        room.hvac_mode,
                        room.hvac_action,
                        room.valve_opening_degree,
                        room.valve_closing_degree,
                        room.battery_level,
                        room.linkquality,
                        _boolean(temperature_result is not None),
                        _boolean(temperature_result),
                        _boolean(mode_result is not None),
                        _boolean(mode_result),
                        _milliseconds(room.override_until),
                        room.override_mode,
                        room.override_scope_type,
                        room.override_scope_id,
                        _milliseconds(room.next_schedule_at),
                        room.next_preset,
                        room.next_scheduled_temperature,
                        room.warning,
                    ),
                )
            if should_prune:
                cutoff = cycle_finished_at.astimezone(UTC) - timedelta(days=self.retention_days)
                connection.execute(
                    "DELETE FROM control_cycles WHERE recorded_at_ms < ?",
                    (_milliseconds(cutoff),),
                )
        if should_prune:
            self._last_pruned_at = cycle_finished_at.astimezone(UTC)

    def _mark_failure(self, exc: Exception) -> None:
        with self._state_lock:
            self._last_error = f"{type(exc).__name__}: {exc}"
            self._consecutive_failures += 1

    def health(self) -> MetricsHealth:
        try:
            with self._connect() as connection:
                schema = connection.execute(
                    "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
                ).fetchone()
                counts = connection.execute(
                    """
                    SELECT COUNT(*) AS cycle_count,
                           MIN(recorded_at_ms) AS oldest,
                           MAX(recorded_at_ms) AS latest
                    FROM control_cycles
                    """
                ).fetchone()
                samples = connection.execute(
                    "SELECT COUNT(*) AS room_sample_count FROM room_samples"
                ).fetchone()
        except Exception as exc:
            self._mark_failure(exc)
            with self._state_lock:
                return MetricsHealth(
                    healthy=False,
                    schema_version=None,
                    retention_days=self.retention_days,
                    cycle_count=0,
                    room_sample_count=0,
                    oldest_sample_at=None,
                    latest_sample_at=None,
                    database_size_bytes=self._database_size(),
                    last_successful_write_at=(
                        self._last_successful_write_at.isoformat()
                        if self._last_successful_write_at
                        else None
                    ),
                    consecutive_failures=self._consecutive_failures,
                    last_error=self._last_error,
                )

        with self._state_lock:
            last_successful = self._last_successful_write_at
            if last_successful is None and counts["latest"] is not None:
                last_successful = datetime.fromtimestamp(counts["latest"] / 1000, tz=UTC)
            return MetricsHealth(
                healthy=self._last_error is None,
                schema_version=int(schema["version"]),
                retention_days=self.retention_days,
                cycle_count=int(counts["cycle_count"]),
                room_sample_count=int(samples["room_sample_count"]),
                oldest_sample_at=_iso_from_milliseconds(counts["oldest"]),
                latest_sample_at=_iso_from_milliseconds(counts["latest"]),
                database_size_bytes=self._database_size(),
                last_successful_write_at=last_successful.isoformat() if last_successful else None,
                consecutive_failures=self._consecutive_failures,
                last_error=self._last_error,
            )

    def _database_size(self) -> int:
        return sum(
            candidate.stat().st_size
            for candidate in (
                self.path,
                self.path.with_name(f"{self.path.name}-wal"),
                self.path.with_name(f"{self.path.name}-shm"),
            )
            if candidate.exists()
        )
