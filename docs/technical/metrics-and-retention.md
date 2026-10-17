# Metrics and retention

Heat Steward stores control history in
`/data/heat-steward-metrics.db`, a versioned SQLite database included in normal
Home Assistant add-on backups.

## What is recorded

Every completed control cycle records system and relay information, including:

- cycle timing and success;
- Home/Away mode and active actions;
- requested and actual heating and hot-water state;
- heat-request count, warnings, and safety state;
- command attempts and outcomes;
- add-on version.

Each room also records:

- external, TRV, and effective temperature;
- the exact temperature source and entity;
- schedule, effective target, next target, and override context;
- availability, demand, TRV state, and calculated command;
- optional valve position, battery, and link quality;
- warning and command outcomes.

## Retention and charting

Raw samples are retained for 90 days. Cleanup occurs during successful writes.
The Diagnostics chart offers 6-hour, 24-hour, and 7-day views and groups samples
into suitable time buckets. Up to 16 radiators can be compared at once.

Predictive heating reads up to the last 30 days from this same database. Deleting
the database removes history and learned evidence; Heat Steward will create a
new database and learn again.

## Failure behavior

Metrics are deliberately fail-open. If the database cannot be read or written:

- normal heating control continues;
- Diagnostics reports the storage problem;
- collection is retried on the next cycle;
- predictive heating falls back to normal hysteresis when it cannot obtain a
  usable model.

## Diagnostics export and privacy

**Download diagnostics** exports current configuration, controller diagnostics,
and the current states of entities configured for heating. Secrets such as the
Discord webhook are removed. It does not export the full 90-day SQLite history.

Review the JSON before sharing it: entity IDs, room names, device details, and
current temperatures can still describe your home.
