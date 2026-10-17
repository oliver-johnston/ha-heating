# Safety and fault handling

Heat Steward is designed to isolate a problem rather than stop every healthy
part of the system.

## Recoverable problems

- A stale or unavailable TRV is skipped and removed from the boiler request
  count.
- A stale external thermometer falls back to the TRV's internal sensor.
- An unavailable relay is isolated immediately while unrelated room or hot-water
  control continues. A critical notification is sent only if the relay remains
  unavailable for 90 seconds, avoiding false alerts during Home Assistant startup.
- Unconfirmed Home Assistant commands are retried a limited number of times.
- A metrics-storage failure disables learning and history, not heating control.
- Repeated loop failures create alerts while the controller keeps retrying.

When the problem clears, control resumes automatically. If recovery
notifications are enabled, Heat Steward sends one recovery message.

## Hard safety stop

The maximum continuous boiler runtime is the only automatic hard stop. If the
heating relay stays on for longer than this limit, Heat Steward:

1. requests the heating relay off;
2. saves a latched fault;
3. keeps requesting the relay off;
4. requires acknowledgement before relay control resumes.

The automatic-control setting remains enabled, so acknowledging the resolved
problem is enough to resume. Do not acknowledge the stop until you understand
why it happened.

## Emergency stop

**Emergency stop** is a deliberate user action. After confirmation it disables
automatic control and requests the central-heating relay off. Use it when the
system is behaving unexpectedly, then investigate Diagnostics before enabling
control again.

## Preflight checks

Before automatic control is enabled, Heat Steward checks that setup is complete
and that no safety stop is waiting. It also reports warnings for unavailable
TRVs, sensors, and relays. Warnings do not block healthy parts of the system.

## Important limits

Heat Steward is software, not a boiler safety device. Keep the boiler's own
thermostat, pressure protection, overheat cut-out, timer, and professional
installation in place. Test relay mappings and Emergency stop while someone is
home.
