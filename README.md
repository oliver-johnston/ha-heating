# Home Heating

A focused Home Assistant add-on for controlling SONOFF TRVZB radiator valves,
a central-heating relay, and a hot-water relay.

The add-on discovers compatible SONOFF
TRVs from Home Assistant's device registry, derives all device entities, and
walks through a setup wizard for devices, optional boiler and hot-water control,
global temperature presets, weekly room-group schedules, and an on/off hot-water
schedule. Boiler settings include
the number of radiator heat requests required before the heating relay turns on. The
resulting system configuration is validated and versioned.

The controller evaluates schedules every 30 seconds by default. It can use a paired
room sensor to decide whether heat is required, while SONOFF valves remain in heat
mode using their own internal sensors. A configurable offset commands each valve
above or below the scheduled target. Automatic device writes are disabled by default
until explicitly enabled on the Control page.

Enabling control is guarded by a live pre-flight checklist. Every command is
read back from Home Assistant for up to five seconds and retried a bounded number of times.
Unavailable devices and unconfirmed commands never change the automatic-control setting:
the controller isolates the affected device, reports the problem, and keeps retrying while
healthy rooms and relays continue to operate. The configurable failure threshold controls
when an alert is raised, not whether control is disabled.

The maximum continuous boiler runtime is the sole automatic hard safety stop. It turns only
the heating relay off and pauses control until the stop is acknowledged; the automatic-control
setting remains enabled and operation resumes after acknowledgement. A two-step Emergency Stop
and the explicit control toggle remain available when a person intends to disable control.
Home Assistant Supervisor also monitors the controller's health endpoint and can restart an
unresponsive add-on. The controller recovers from isolated unexpected failures with bounded
backoff; repeated crashes terminate the process so Supervisor can restart it.

An unavailable or stale TRV is isolated rather than treated as a whole-system failure:
that room is skipped, contributes no heat request, and appears as a warning while
the remaining rooms and boiler continue to be controlled. A stale external sensor
falls back to the TRV's internal measurement. External sensor freshness uses its
companion last-seen entity by default, avoiding false warnings when a stable temperature
has not changed. The health entity, fallback mode, and per-sensor timeout can be changed
on the Devices page. TRVs use a one-hour freshness window by default and a quiet TRV is
labelled **Not recently seen**, distinct from an entity Home Assistant reports as unavailable.
A configured relay becoming unavailable raises a critical alert, but it does not stop the
rest of the system. Heating and hot-water relays are isolated from one another and resume
automatically when Home Assistant reports them available again.

Changing devices, schedules, presets, or active control parameters keeps automatic
control running and immediately reconciles the system against the validated change.
Changing relay entities first confirms the old relays are off. An incomplete schedule
setup safely turns the relays off without silently changing the control toggle.

Home and Away modes sit above the weekly schedules. Home follows each room schedule;
Away uses a configurable preset (Eco by default). The dashboard can temporarily Boost
one room group or the whole house for 30 minutes, one hour, two hours, or four hours.
Boost takes precedence over Away, expires automatically, and both modes and boosts
survive restarts. Home Assistant automations can set Home or Away by firing the
`ha_heating_set_mode` event; boost remains a deliberate dashboard control.

The Diagnostics tab shows control-loop health, requested and actual relay states,
the reasoning behind every room decision, current warnings, and the most recent
control actions. The activity history is deliberately bounded, persists across
restarts, and can be downloaded with a diagnostic snapshot containing only configured
heating entities. Configuration and event history live under `/data`, which Home
Assistant includes in add-on backups; the add-on declares cold-backup mode.

Optional Discord notifications use a channel webhook directly, so a controller problem
can still be reported when Home Assistant's service API is unavailable. Critical faults
and unavailable relays are immediate; TRV and external-sensor warnings use a configurable
delay. Alerts are deduplicated across restarts and can send a single recovery message.
The webhook is treated as a secret and is excluded from UI API responses and diagnostic
exports. Home Assistant persistent notifications remain enabled for repeated control
problems and maximum-runtime safety stops.

## Development

The easiest way to work on the add-on is the self-contained local harness:

```sh
make harness
```

This installs the Python and Node dependencies on first use, builds the real
frontend, and starts:

- Home Heating at <http://127.0.0.1:8099/>
- an imaginary Home Assistant at <http://127.0.0.1:18123/>

The simulator exposes eight SONOFF TRVs, eight matching temperature sensors,
and the central-heating and hot-water relays. Its control page can switch between
a healthy system and useful failure cases (missing TRV entities, an unavailable
temperature sensor or TRV, ignored device commands, or no TRVs). It also lets you change every room temperature,
TRV target and mode, and toggle the two boiler relays. Change a discovery scenario,
then select **Rescan devices** in Home Heating. Saved onboarding configuration lives
in `.dev-data/` and can be reset from the simulator.

The simulator has its own Material Web frontend build. Its source and generated
assets are excluded from the add-on image.

To run the automated checks separately:

```sh
make test
make soak
make lint
npm --prefix addon/frontend run build
```

`make soak` runs a deterministic seven-day simulation with schedule transitions,
thermal changes, a stale external sensor, an unavailable TRV, and a transient relay
failure. It advances simulated time without waiting seven real days.

For local backend development, set `SUPERVISOR_TOKEN` and optionally
`HA_BASE_URL`, `CONFIG_PATH`, and `PORT`, then run:

```sh
PYTHONPATH=addon/src python -m ha_heating.main
```

## Repository layout

- `addon/`: Home Assistant add-on image, Python service, and React/TypeScript ingress UI.
- `tests/`: onboarding, configuration, scheduling, and controller tests.

Home Assistant builds with `addon/` as the Docker context. The Dockerfile uses
Node only in its frontend build stage; the final runtime image contains Python
and the generated static files, but no Node installation. Compiled frontend
assets are intentionally not committed.

The React frontend uses pinned, selectively imported `@material/web` components
for controls and typography. `styles.css` contains only the Material theme tokens
and application-specific layout; there is no runtime CDN dependency.
