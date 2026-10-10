# Home Heating

A focused Home Assistant add-on for controlling SONOFF TRVZB radiator valves,
a central-heating relay, and a hot-water relay.

The first milestone is safe onboarding. The add-on discovers compatible SONOFF
TRVs from Home Assistant's device registry, derives all device entities, and
walks through a setup wizard for devices, optional boiler and hot-water control,
global temperature presets, and weekly room-group schedules. Boiler settings include
the number of radiator heat requests required before the heating relay turns on. The
resulting system configuration is validated and versioned.

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
temperature sensor, or no TRVs). It also lets you change every room temperature,
TRV target and mode, and toggle the two boiler relays. Change a discovery scenario,
then select **Rescan devices** in Home Heating. Saved onboarding configuration lives
in `.dev-data/` and can be reset from the simulator.

The simulator has its own Material Web frontend build. Its source and generated
assets are excluded from the add-on image.

To run the automated checks separately:

```sh
make test
make lint
npm --prefix addon/frontend run build
```

For local backend development, set `SUPERVISOR_TOKEN` and optionally
`HA_BASE_URL`, `CONFIG_PATH`, and `PORT`, then run:

```sh
PYTHONPATH=addon/src python -m ha_heating.main
```

## Repository layout

- `addon/`: Home Assistant add-on image, Python service, and React/TypeScript ingress UI.
- `tests/`: controller-independent onboarding and configuration tests.

Home Assistant builds with `addon/` as the Docker context. The Dockerfile uses
Node only in its frontend build stage; the final runtime image contains Python
and the generated static files, but no Node installation. Compiled frontend
assets are intentionally not committed.

The React frontend uses pinned, selectively imported `@material/web` components
for controls and typography. `styles.css` contains only the Material theme tokens
and application-specific layout; there is no runtime CDN dependency.
