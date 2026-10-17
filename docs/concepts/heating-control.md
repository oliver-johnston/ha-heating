# Heating control

Heat Steward makes a separate decision for every radiator, then combines those
decisions to control the optional boiler relay.

## Target and measured temperature

The effective target normally comes from the room schedule. Home/Away mode and
temporary overrides can replace it. See
[Schedules and overrides](schedules-and-overrides.md) for the exact order.

The measured temperature comes from the selected external sensor when it is
healthy. Otherwise Heat Steward uses the TRV's internal reading.

## When a room requests heat

With the default `0.2°C` hysteresis, a room with a `21°C` target:

- starts requesting heat at or below `20.8°C`;
- stops requesting heat at or above `21°C`;
- keeps its previous state between those values.

Keeping the previous state inside this band prevents rapid switching when the
temperature moves by a small amount.

## Why the TRV target looks different

The room target and the value sent to the TRV serve different purposes. When a
room needs heat, Heat Steward adds the **Heating offset** so the valve opens
decisively. When the room is satisfied, it subtracts the **Idle offset** so the
valve closes decisively.

For a `21°C` room target and the default `2°C` offsets, the TRV may therefore be
commanded to `23°C` while heating and `19°C` while idle. This is expected. The
command is rounded to the nearest half degree and kept within the TRV's `4–35°C`
range.

## Room status

The dashboard may show a room as:

- **Heating** — it requests heat and the TRV reports active heating.
- **Waiting** — it requests heat but the configured boiler relay is off.
- **Opening** — it requests heat while the valve is opening or has not yet
  reported active heating.
- **Closing** — demand has stopped but the TRV still reports heating.
- **Within range** — the room is inside the hysteresis band and retains its
  satisfied state.
- **Idle** — the target is satisfied.
- **Stale** or **Unavailable** — the room is isolated and does not count toward
  boiler demand.

## Boiler demand

Only available rooms that currently request heat are counted. The heating relay
is requested when that count reaches **Minimum heat requests**. Minimum on and
off times are then applied to reduce short cycling.

If no heating relay is configured, the same room decisions still control the
TRVs. Learn more in [Boiler and hot-water control](../features/boiler-control.md).
