# Schedules and overrides

Schedules describe normal operation. Modes and temporary overrides let you
change that operation without editing the weekly plan.

## Room schedules

Every room group has:

- a default preset, used outside timed periods;
- any number of weekday periods, each selecting Boost, Comfort, Eco, or Frost.

Periods use local Home Assistant time, must end on the same day they start, and
cannot overlap. To cover midnight, create one period ending at `23:59` and
another starting at `00:00` on the next day.

## Home and Away

**Home** follows room schedules. **Away** replaces scheduled room targets with
the configured Away preset, which is Frost by default. Away also turns scheduled
hot water off.

A temperature or hot-water override is deliberate and can still apply during
Away mode.

Home Assistant automations can change the mode by firing an event:

```yaml
action:
  - event: heat_steward_set_mode
    event_data:
      mode: away
```

Use `mode: home` to return to schedules.

## Temporary overrides

An override can apply to one room, one room group, or the whole house. It can
select a preset or a custom temperature for 30 minutes, one hour, two hours, or
four hours. Hot water has a separate on/off override.

For a room, the active target is chosen in this order:

1. The most recently applied override that covers that room.
2. The Away preset when Away mode is active.
3. The active schedule period, or the room group's default preset.

“Most recently applied” matters when scopes overlap. For example, a room
override applied after a whole-house override wins for that room; a later
whole-house override would replace it until one is cancelled or expires.

Overrides are saved immediately, survive an add-on restart, and expire on the
next control cycle after their end time. Cancelling one restores the next
applicable override, Away target, or schedule.

## Predictive heating and schedules

Predictive heating only prepares for schedule changes to a higher temperature
and only coasts during schedule-driven control. It never predicts an override or
Away target. This keeps deliberate temporary actions immediate and predictable.
