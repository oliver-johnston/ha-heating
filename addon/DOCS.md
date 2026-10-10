# Home Heating

Home Heating is currently in its onboarding milestone. Open the add-on Web UI
to discover and configure the heating system.

## Configuration

1. Select the SONOFF TRVZB devices the add-on should control.
2. Give each valve a room group. Multiple valves can share one group.
3. Optionally select an external temperature sensor for each group.
4. Optionally select the central-heating and hot-water switches.
5. Choose how many radiators must request heat before central heating starts.
6. Configure temperature presets, room-group schedules, and the hot-water schedule.

Selecting a TRV device automatically maps its climate entity and related
SONOFF entities, including external-temperature input, local temperature,
battery, last-seen, child-lock, smart-temperature-control and valve diagnostics.

This release does not yet operate the valves or relays.
