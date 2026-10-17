# Boiler and hot-water control

Heat Steward can control central heating and hot water through Home Assistant
`switch` entities. Either switch can be omitted.

## Central heating

Each available room decides whether it needs heat. Heat Steward counts those
requests and asks the central-heating switch to turn on when the count reaches
**Minimum heat requests**.

Setting the threshold above `1` can avoid running a large boiler for one small
radiator, but it also means a lone cold room may wait indefinitely. Use `1`
unless you understand that trade-off.

Minimum on and off times reduce short cycling:

- **Minimum boiler on time** delays a requested shutoff until the boiler has run
  long enough.
- **Minimum boiler off time** delays a requested start until the boiler has
  rested long enough.

The dashboard and Diagnostics distinguish the requested state from the actual
relay state, including any anti-cycle delay.

## TRV-only operation

Without a central-heating switch, Heat Steward still schedules TRVs and changes
their setpoints. Another controller must decide when heat is available. The
predictive learner only accepts warm-up evidence when it can confirm that the
configured boiler relay was on, so predictive heating will not become available
in TRV-only mode.

## Hot water

Hot water has its own weekly on/off schedule and temporary override. Away mode
forces scheduled hot water off, but a deliberate hot-water override can still
turn it on.

Hot-water failures are handled separately from central-heating failures. A
problem with one relay does not stop control of the other.

## Command verification

Heat Steward reads commands back from Home Assistant for up to five seconds and
retries them up to the configured limit. Repeated failures create an issue and
notification, but recoverable failures do not silently disable all automatic
control.

The maximum continuous boiler runtime is different: exceeding it creates a
latched safety stop. See [Safety and fault handling](safety.md).
