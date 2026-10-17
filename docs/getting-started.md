# Getting started

Heat Steward controls SONOFF TRVZB radiator valves through Home Assistant. A
central-heating relay and a hot-water relay are optional.

## What you need

- Home Assistant 2026.1 or newer with Supervisor and add-on support.
- At least one SONOFF TRVZB already working in Home Assistant.
- Optional room-temperature sensors exposed as `sensor` or `input_number`
  entities.
- Optional `switch` entities for central heating and hot water.

Give devices clear names and assign them to Home Assistant areas first. This
makes the setup screens much easier to understand.

## Install

1. In Home Assistant, open **Settings → Add-ons → Add-on Store**.
2. Open the top-right menu and choose **Repositories**.
3. Add `https://github.com/oliver-johnston/heat-steward`.
4. Install and start **Heat Steward**.
5. Enable **Show in sidebar**, then open its web interface.

No YAML configuration is required.

## Complete the setup wizard

### 1. Radiators

Select each valve that Heat Steward should control. Give it a room group and,
if needed, choose an external room thermometer. Several valves can share a room
group and schedule.

Expand **Technical details** if you want to check the Home Assistant entities
found for a valve.

### 2. Boiler

Choose a central-heating switch, a hot-water switch, both, or neither. Without a
heating switch, Heat Steward still schedules and controls the radiator valves.

Set **Minimum heat requests** to the number of available rooms that must request
heat before the central-heating switch turns on. Start with `1` unless your
system has a reason to require more.

### 3. Schedules

Each room group has a default preset and optional timed periods. The default is
used whenever no period is active. Periods cannot overlap on the same day.

Hot water has a separate on/off schedule. It has no effect unless a hot-water
switch is configured.

## Before enabling automatic control

Review the dashboard and confirm:

- Every room shows a believable temperature.
- Each room has the intended schedule and target.
- The heating and hot-water switches point to the correct relays.
- **Minimum heat requests** is no higher than the number of usable rooms.
- The boiler's own thermostat, timer, and safety devices remain operational.

Enable automatic control while someone is home. Watch at least one room request
heat, confirm the right TRV opens, and confirm the heating relay behaves as
expected. Also test **Emergency stop**.

Next, read [Heating control](concepts/heating-control.md) and the
[Safety guide](features/safety.md).
