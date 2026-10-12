from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from heat_steward.metrics import CycleCommandResults, MetricsStore


def sample_cycle(at: datetime):
    entities = SimpleNamespace(climate="climate.dining_trv")
    trv = SimpleNamespace(
        device_id="device-dining",
        name="Dining TRV",
        area_name="Dining",
        room_group="Downstairs",
        entities=entities,
    )
    config = SimpleNamespace(
        trvs=[trv],
        control=SimpleNamespace(
            enabled=True,
            cycle_interval_seconds=30,
            hysteresis=0.5,
            heating_offset=2.0,
            idle_offset=2.0,
        ),
        minimum_heat_requests=1,
        boiler_switch="switch.central_heating",
        hot_water_switch="switch.hot_water",
    )
    room = SimpleNamespace(
        device_id="device-dining",
        room_group="Downstairs",
        available=True,
        status="heating",
        current_temperature=20.25,
        current_temperature_entity="sensor.dining_temperature",
        external_temperature=20.25,
        trv_temperature=19.8,
        external_temperature_freshness="last_seen",
        external_temperature_age_seconds=15.0,
        external_temperature_stale_after_seconds=5400,
        trv_last_seen_at=at - timedelta(seconds=10),
        schedule_preset="comfort",
        schedule_temperature=21.0,
        preset="boost",
        scheduled_temperature=23.0,
        control_source="override",
        commanded_temperature=25.0,
        trv_target_temperature=23.0,
        demand=True,
        hvac_mode="heat",
        hvac_action="heating",
        valve_opening_degree=72.0,
        valve_closing_degree=10.0,
        battery_level=84.0,
        linkquality=96.0,
        override_until=at + timedelta(hours=1),
        override_mode="preset",
        override_scope_type="room",
        override_scope_id="device-dining",
        next_schedule_at=at + timedelta(hours=2),
        next_preset="eco",
        next_scheduled_temperature=16.0,
        warning=None,
    )
    plan = SimpleNamespace(
        generated_at=at,
        rooms=(room,),
        heat_requests=1,
        boiler_should_be_on=True,
        boiler_is_on=False,
        hot_water_should_be_on=False,
        hot_water_is_on=False,
        hot_water_next_change_at=at + timedelta(hours=3),
        hot_water_next_state="on",
    )
    return config, plan


def record_sample(store: MetricsStore, at: datetime) -> None:
    config, plan = sample_cycle(at)
    store.record_cycle(
        config=config,
        plan=plan,
        heating_mode="home",
        commands=CycleCommandResults(
            room_temperature={"device-dining": True},
            boiler=True,
        ),
        cycle_started_at=at - timedelta(milliseconds=250),
        cycle_finished_at=at,
        cycle_successful=True,
        control_error=None,
        fault_latched=False,
        fault_reason=None,
        app_version="test",
        actions=("Set Dining TRV to 25°C",),
    )


def test_metrics_store_migrates_and_records_complete_cycle(tmp_path):
    path = tmp_path / "heat-steward-metrics.db"
    store = MetricsStore(path)
    at = datetime(2026, 10, 12, 7, 30, tzinfo=UTC)

    record_sample(store, at)

    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        assert connection.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 1
        cycle = connection.execute("SELECT * FROM control_cycles").fetchone()
        room = connection.execute("SELECT * FROM room_samples").fetchone()

    assert cycle["heating_mode"] == "home"
    assert cycle["heat_requests"] == 1
    assert cycle["hysteresis"] == 0.5
    assert cycle["boiler_requested"] == 1
    assert cycle["boiler_command_sent"] == 1
    assert cycle["boiler_command_succeeded"] == 1
    assert cycle["duration_ms"] == 250
    assert cycle["actions_json"] == '["Set Dining TRV to 25°C"]'
    assert room["device_id"] == "device-dining"
    assert room["current_temperature"] == 20.25
    assert room["schedule_preset"] == "comfort"
    assert room["effective_preset"] == "boost"
    assert room["effective_target_temperature"] == 23.0
    assert room["commanded_temperature"] == 25.0
    assert room["valve_opening_degree"] == 72.0
    assert room["battery_level"] == 84.0
    assert room["temperature_command_sent"] == 1
    assert room["temperature_command_succeeded"] == 1
    assert room["override_scope_type"] == "room"

    health = store.health()
    assert health.healthy is True
    assert health.schema_version == 1
    assert health.cycle_count == 1
    assert health.room_sample_count == 1
    assert health.latest_sample_at == at.isoformat()
    assert health.database_size_bytes > 0

    reopened = MetricsStore(path)
    assert reopened.health().schema_version == 1
    assert reopened.health().cycle_count == 1


def test_metrics_store_reads_chart_ready_room_history(tmp_path):
    store = MetricsStore(tmp_path / "heat-steward-metrics.db")
    at = datetime(2026, 10, 12, 7, 30, tzinfo=UTC)

    record_sample(store, at)
    record_sample(store, at + timedelta(seconds=30))
    record_sample(store, at + timedelta(seconds=60))
    with sqlite3.connect(store.path) as connection:
        connection.execute(
            "UPDATE control_cycles SET boiler_actual = 1 WHERE generated_at_ms = ?",
            (round((at + timedelta(seconds=30)).timestamp() * 1000),),
        )

    history = store.room_history(
        ["device-dining"],
        start_at=at - timedelta(minutes=1),
        end_at=at + timedelta(minutes=1),
        bucket_seconds=120,
    )

    assert len(history) == 2
    assert history[0]["observed_at"] == (at + timedelta(seconds=30)).isoformat()
    assert history[0]["boiler_on"] is True
    assert history[0]["heating"] is True
    assert history[1] == {
        "observed_at": (at + timedelta(seconds=60)).isoformat(),
        "device_id": "device-dining",
        "room_name": "Dining",
        "room_group": "Downstairs",
        "available": True,
        "status": "heating",
        "actual_temperature": 20.25,
        "external_temperature": 20.25,
        "trv_temperature": 19.8,
        "scheduled_temperature": 21.0,
        "target_temperature": 23.0,
        "commanded_temperature": 25.0,
        "reported_target_temperature": 23.0,
        "preset": "boost",
        "control_source": "override",
        "demand": True,
        "boiler_on": False,
        "heating": False,
        "hvac_action": "heating",
        "valve_opening_degree": 72.0,
    }


def test_metrics_store_prunes_expired_raw_samples(tmp_path):
    store = MetricsStore(
        tmp_path / "heat-steward-metrics.db",
        retention_days=1,
        prune_interval=timedelta(0),
    )
    first = datetime(2026, 10, 10, 7, 30, tzinfo=UTC)

    record_sample(store, first)
    record_sample(store, first + timedelta(days=2))

    health = store.health()
    assert health.cycle_count == 1
    assert health.room_sample_count == 1
    assert health.oldest_sample_at == (first + timedelta(days=2)).isoformat()


def test_metrics_store_rejects_newer_database_schema(tmp_path):
    path = tmp_path / "heat-steward-metrics.db"
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at_ms INTEGER)"
        )
        connection.execute("INSERT INTO schema_migrations(version, applied_at_ms) VALUES (99, 0)")

    health = MetricsStore(path).health()

    assert health.healthy is False
    assert health.schema_version is None
    assert "newer than supported" in str(health.last_error)
