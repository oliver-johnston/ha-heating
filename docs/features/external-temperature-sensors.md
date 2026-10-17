# External temperature sensors

A radiator valve sits beside a heat source, so its internal reading may not
represent the whole room. Heat Steward can use a separate Home Assistant
temperature entity for its room decision while leaving the TRV itself on its
internal sensor.

## Supported entities

Choose a `sensor` or `input_number` entity that reports a numeric temperature.
Use one that updates reliably and is positioned away from the radiator, direct
sunlight, open windows, and draughts.

## Freshness checks

Heat Steward must know whether a reading is current. Each external sensor has
one of these modes:

- **Auto** — use a suitable last-seen entity from the same device when
  available; otherwise use Home Assistant state-update timestamps.
- **Last seen** — use the selected last-seen entity.
- **State updates** — use the temperature entity's Home Assistant update time.
- **Disabled** — do not reject the sensor because of age.

Auto is the best starting point. The global stale time is 90 minutes by default,
and a room can override it. Set the timeout longer than the sensor's normal
reporting interval, but not so long that an old reading could control the room
for hours unnoticed.

## Safe fallback

If the external sensor is unavailable, non-numeric, or stale, Heat Steward:

1. raises a warning;
2. uses the TRV's internal temperature if it is usable;
3. continues controlling the room.

If neither source is usable, the room is isolated and excluded from boiler
demand. Other rooms continue normally.

## Interaction with predictive heating

Predictive learning records the exact temperature source and entity used. It
does not mix readings from different sensors. If control falls back to the TRV,
only a model learned from that TRV entity can be used for prediction. When the
external sensor recovers, its own compatible model is used again after enough
recent evidence exists.
