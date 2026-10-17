# Heat Steward documentation

These guides explain how to set up, use, tune, and troubleshoot Heat Steward.
Start with the short add-on manual in Home Assistant, then use this page when
you want more detail.

## Start here

- [Getting started](getting-started.md) — install Heat Steward and complete the
  first setup safely.
- [Heating control](concepts/heating-control.md) — understand targets, demand,
  hysteresis, and TRV commands.
- [Schedules and overrides](concepts/schedules-and-overrides.md) — learn which
  target wins and how Home and Away work.
- [Troubleshooting](troubleshooting.md) — work through common symptoms.

## Features

- [Predictive heating](features/predictive-heating.md)
- [External temperature sensors](features/external-temperature-sensors.md)
- [Boiler and hot-water control](features/boiler-control.md)
- [Safety and fault handling](features/safety.md)

## Configure and tune

- [Settings reference](reference/settings.md)
- [Practical tuning examples](tuning-examples.md)
- [Diagnostics guide](reference/diagnostics.md)
- [Stored configuration and data](reference/configuration-schema.md)

## Technical detail

- [Predictive-heating algorithm](technical/predictive-heating-algorithm.md)
- [Control cycle](technical/control-cycle.md)
- [Metrics and retention](technical/metrics-and-retention.md)

Heat Steward is experimental and can operate heating relays. Test a new setup
while someone is home, and keep the boiler's own safety controls in place.
