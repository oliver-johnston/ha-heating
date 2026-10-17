# Stored configuration and data

Most users should change settings through the Heat Steward interface. This page
explains what is stored for backups, recovery, and technical support; it is not
an invitation to edit add-on files by hand.

## Files under `/data`

| File | Purpose |
| --- | --- |
| `heat-steward-config.json` | Versioned configuration, setup progress, and latched safety state. |
| `heat-steward-actions.json` | Append-only Home/Away and temporary-override action ledger. |
| `heat-steward-events.json` | Recent user-facing controller activity. |
| `heat-steward-notifications.json` | Notification delivery and recovery state. |
| `heat-steward-metrics.db` | Versioned SQLite control and room history. |

Home Assistant includes the add-on's `/data` directory in backups. Heat Steward
uses cold-backup mode so these files are captured while the add-on is stopped.

## Configuration shape

The JSON configuration contains these main sections:

- `schema_version` and `updated_at`;
- optional central-heating and hot-water switch entity IDs;
- minimum room-request threshold;
- `control`, including timing, offsets, freshness, safety limits, and the global
  predictive switch;
- `safety`, including a latched maximum-runtime stop;
- `notifications`;
- configured `trvs`, their discovered entities, groups, sensors, freshness, and
  per-room predictive switch;
- temperature `presets`;
- room and hot-water `schedules`;
- setup completion state.

The current schema version is `9`. Older supported data is migrated when loaded,
then validated before use. Unknown fields and invalid combinations are rejected.

## Persistence behavior

Configuration writes are atomic and stored with restricted file permissions.
Mode changes and overrides are immutable actions with increasing sequence
numbers. Replaying that ledger makes active state deterministic after a restart.
If the ledger cannot be read, Heat Steward keeps the last valid in-memory state
and refuses to overwrite the damaged file.

Expired actions stop affecting control, although bounded history can remain for
diagnostics. Raw metric samples are retained for 90 days.

## Restoring or moving an installation

Use a normal Home Assistant backup that includes the add-on. After restore,
check entity mappings because Home Assistant entity or device IDs may differ on
a different installation. Review Diagnostics before re-enabling automatic
control.
