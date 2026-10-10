# Home Heating

Home Heating is currently in its onboarding milestone. Open the add-on Web UI
to discover and configure the heating system.

## Configuration

1. Select the SONOFF TRVZB devices the add-on should control.
2. Give each valve a room group. Multiple valves can share one group.
3. Optionally select an external temperature sensor for each group.
4. Optionally select the central-heating and hot-water switches.
5. Choose how many radiators must request heat before central heating starts.
6. Configure the control cycle, valve behaviour, and boiler anti-cycling limits.
7. Configure temperature presets, room-group schedules, and the hot-water schedule.
8. Optionally configure direct Discord notifications from a channel webhook.

Selecting a TRV device automatically maps its climate entity and related
SONOFF entities, including external-temperature input, local temperature,
battery, last-seen, child-lock, smart-temperature-control and valve diagnostics.

## Heating control

The add-on checks the active schedule every 30 seconds by default. When a room is
below its scheduled target, the valve target is raised by 2°C; when satisfied, it is
lowered by 2°C. Both offsets and the hysteresis are configurable.

External room sensors inform the add-on's decision only. By default their values are
not written to the valve: each TRV stays in heat mode and continues using its internal
sensor, so it remains directly usable if the add-on stops. Automatic control is off
until it is explicitly enabled on the Control page.

When available, the add-on pairs an external thermometer with the last-seen entity on
the same Home Assistant device. This is a more reliable health signal than waiting for
the temperature value itself to change. The Devices page allows the pairing and timeout
to be overridden, or freshness checking to use temperature updates or be disabled.

## Diagnostics

The Diagnostics tab reports whether the control loop is healthy and on time, compares
requested relay states with their current Home Assistant states, and explains every
room's current heating decision. Sensor fallbacks, unavailable devices, relay state
mismatches, and controller errors appear in the Issues section.

Recent activity records control-mode changes and commands sent to Home Assistant. It
keeps a bounded event history that persists across add-on restarts.

## Notifications

The Notifications tab can send critical alerts directly to a Discord channel webhook.
Warning notifications for unavailable TRVs and external-sensor fallback can also be
enabled with a delay to ignore brief dropouts. Alerts are sent once when an issue begins
and, optionally, once when it recovers. Use **Send test** after saving the webhook.

The webhook is stored with the add-on configuration but is never returned to the UI,
written to logs, or included in downloaded diagnostics. Treat it as a password and rotate
it in Discord if it is ever exposed. Home Assistant persistent notifications continue to
be used for safety faults even when Discord notifications are disabled.
