import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  MdCheckbox,
  MdDialog,
  MdFilledButton,
  MdMenu,
  MdMenuItem,
  MdOutlinedButton,
  MdOutlinedSelect,
  MdOutlinedTextField,
  MdPrimaryTab,
  MdSelectOption,
  MdSwitch,
  MdTabs,
  MdTextButton,
} from "./material";
import {
  OverrideDialog,
  type ActiveHotWaterOverride,
  type ActiveTemperatureOverride,
  type OverrideActionPayload,
  type OverrideTarget,
} from "./OverrideDialog";
import { PresetIcon } from "./PresetIcon";
import heatStewardIcon from "./assets/heat-steward-icon.svg";

type EntityMap = Record<string, string | null>;

type DiscoveredTRV = {
  device_id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  software_version: string | null;
  area_name: string | null;
  suggested_group: string;
  suggested_temperature_sensor: string | null;
  entities: EntityMap;
  missing_recommended: string[];
};

type EntityOption = {
  entity_id: string;
  name: string;
  entity_name: string;
  area_name: string | null;
  device_name: string | null;
  state: string | null;
  unit?: string | null;
  suggested_last_seen_entity?: string | null;
};

type Discovery = {
  trvs: DiscoveredTRV[];
  temperature_sensors: EntityOption[];
  health_sensors: EntityOption[];
  switches: EntityOption[];
  suggested: {
    boiler_switch: string | null;
    hot_water_switch: string | null;
  };
};

type SavedTRV = {
  device_id: string;
  room_group: string;
  external_temperature_sensor: string | null;
  external_temperature_last_seen: string | null;
  external_temperature_freshness: FreshnessMode;
  external_sensor_stale_seconds: number | null;
  trv_freshness: FreshnessMode;
  entities: EntityMap;
};

type FreshnessMode = "auto" | "last_seen" | "state_updates" | "disabled";

type TemperaturePresets = {
  boost: number;
  comfort: number;
  eco: number;
  frost: number;
};

type PresetKey = keyof TemperaturePresets;
type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

type SchedulePeriod = {
  days: Weekday[];
  start: string;
  end: string;
  preset: PresetKey;
};

type RoomSchedule = {
  room_group: string;
  default_preset: PresetKey;
  periods: SchedulePeriod[];
};

type HotWaterState = "on" | "off";

type HotWaterPeriod = {
  days: Weekday[];
  start: string;
  end: string;
  state: HotWaterState;
};

type HotWaterSchedule = {
  default_state: HotWaterState;
  periods: HotWaterPeriod[];
};

type SetupProgress = {
  devices: boolean;
  boiler: boolean;
  control: boolean;
  presets: boolean;
  schedules: boolean;
};

type ControlSettings = {
  enabled: boolean;
  cycle_interval_seconds: number;
  heating_offset: number;
  idle_offset: number;
  hysteresis: number;
  trv_mode: "heat";
  temperature_source: "internal";
  away_preset: PresetKey;
  smart_temperature_control: boolean;
  open_window_detection: boolean;
  child_lock: boolean;
  frost_protection_temperature: number;
  minimum_boiler_on_seconds: number;
  minimum_boiler_off_seconds: number;
  maximum_boiler_on_seconds: number;
  command_retries: number;
  failures_before_alert: number;
  external_sensor_stale_seconds: number;
  trv_stale_seconds: number;
};

type SafetyState = {
  fault_latched: boolean;
  fault_reason: string | null;
  fault_at: string | null;
};

type NotificationSettings = {
  enabled: boolean;
  level: "critical" | "warning";
  send_recovery: boolean;
  warning_delay_seconds: number;
  discord_webhook_configured: boolean;
};

type NotificationValues = {
  enabled: boolean;
  level: "critical" | "warning";
  send_recovery: boolean;
  warning_delay_minutes: string;
};

type SavedConfig = {
  boiler_switch: string | null;
  hot_water_switch: string | null;
  minimum_heat_requests: number;
  control: ControlSettings;
  safety: SafetyState;
  notifications: NotificationSettings;
  trvs: SavedTRV[];
  presets: TemperaturePresets;
  setup: SetupProgress;
  schedules: RoomSchedule[];
  hot_water_schedule: HotWaterSchedule;
  updated_at: string;
};

type DashboardRoom = {
  device_id: string;
  room_group: string;
  name: string;
  trv_name: string;
  climate_entity: string;
  current_temperature_entity: string;
  current_temperature: number | null;
  external_temperature: number | null;
  trv_temperature: number | null;
  target_temperature: number | null;
  scheduled_temperature: number;
  commanded_temperature: number;
  preset: PresetKey;
  demand: boolean;
  status: "heating" | "waiting" | "opening" | "closing" | "idle" | "stale" | "unavailable";
  hvac_mode: string | null;
  hvac_action: string | null;
  warning: string | null;
  external_temperature_freshness: FreshnessMode | null;
  external_temperature_health_entity: string | null;
  external_temperature_last_seen_at: string | null;
  external_temperature_age_seconds: number | null;
  external_temperature_stale_after_seconds: number | null;
  trv_last_seen_at: string | null;
  next_schedule_at: string | null;
  next_preset: PresetKey | null;
  next_scheduled_temperature: number | null;
  unit: string;
  available: boolean;
  control_source: "schedule" | "away" | "boost" | "override";
  override_until: string | null;
  override_mode: "preset" | "temperature" | null;
  override_scope_type: "house" | "group" | "room" | null;
  override_scope_id: string | null;
};

type ActiveBoost = {
  room_group: string | null;
  started_at: string;
  expires_at: string;
};

type ActiveHotWaterBoost = {
  started_at: string;
  expires_at: string;
};

type DashboardData = {
  updated_at: string;
  controller: {
    enabled: boolean;
    last_error: string | null;
    heat_requests: number;
    minimum_heat_requests: number;
    boiler_should_be_on: boolean;
    boiler_is_on: boolean | null;
    hot_water_should_be_on: boolean | null;
    hot_water_is_on: boolean | null;
    hot_water_next_change_at: string | null;
    hot_water_next_state: "on" | "off" | null;
    fault_latched: boolean;
    fault_reason: string | null;
  };
  issues: DiagnosticIssue[];
  overrides: {
    mode: "home" | "away";
    away_preset: PresetKey;
    boosts: ActiveBoost[];
    hot_water_boost: ActiveHotWaterBoost | null;
    temperature_overrides?: ActiveTemperatureOverride[];
    hot_water_override?: ActiveHotWaterOverride | null;
  };
  groups: Array<{ name: string; rooms: DashboardRoom[] }>;
};

type DiagnosticIssue = {
  severity: "warning" | "error";
  title: string;
  detail: string;
};

type DiagnosticRoom = {
  device_id: string;
  name: string;
  room_group: string;
  climate_entity: string;
  available: boolean;
  status: DashboardRoom["status"];
  current_temperature: number | null;
  temperature_source: "external" | "TRV";
  temperature_entity: string;
  external_temperature: number | null;
  trv_temperature: number | null;
  external_temperature_freshness: FreshnessMode | null;
  external_temperature_health_entity: string | null;
  external_temperature_last_seen_at: string | null;
  external_temperature_age_seconds: number | null;
  external_temperature_stale_after_seconds: number | null;
  trv_last_seen_at: string | null;
  next_schedule_at: string | null;
  next_preset: PresetKey | null;
  next_scheduled_temperature: number | null;
  schedule_preset: PresetKey;
  schedule_temperature: number;
  scheduled_temperature: number;
  preset: PresetKey;
  demand: boolean;
  commanded_temperature: number;
  reported_target_temperature: number | null;
  hvac_mode: string | null;
  hvac_action: string | null;
  warning: string | null;
  control_source: "schedule" | "away" | "boost" | "override";
  override_until: string | null;
  override_mode: "preset" | "temperature" | null;
  override_scope_type: "house" | "group" | "room" | null;
  override_scope_id: string | null;
  temperature_reason: string;
  demand_reason: string;
  command_reason: string;
};

type DiagnosticRelay = {
  configured: boolean;
  entity_id: string | null;
  requested: boolean | null;
  actual: boolean | null;
};

type DiagnosticsData = {
  updated_at: string;
  overall_status: "monitoring" | "running" | "warning" | "error";
  controller: {
    enabled: boolean;
    loop_status: "starting" | "waiting" | "healthy" | "overdue" | "error";
    cycle_interval_seconds: number;
    last_cycle_started_at: string | null;
    last_cycle_finished_at: string | null;
    last_successful_cycle_at: string | null;
    last_error: string | null;
    waiting_for_readiness: boolean;
    fault_latched: boolean;
    fault_reason: string | null;
    control_alert_reason: string | null;
    consecutive_failures: number;
    loop_restarts: number;
    latest_actions: string[];
    mode: "home" | "away";
    active_boosts: Array<{ room_group: string | null; expires_at: string }>;
    hot_water_boost: ActiveHotWaterBoost | null;
    active_temperature_overrides: ActiveTemperatureOverride[];
    active_hot_water_override: ActiveHotWaterOverride | null;
  };
  plant: {
    boiler: DiagnosticRelay;
    hot_water: DiagnosticRelay;
  };
  issues: DiagnosticIssue[];
  rooms: DiagnosticRoom[];
  events: Array<{ occurred_at: string; level: "info" | "warning" | "error"; message: string }>;
};

type Selection = {
  enabled: boolean;
  room_group: string;
  external_temperature_sensor: string;
  external_temperature_last_seen: string;
  external_temperature_freshness: Exclude<FreshnessMode, "auto">;
  external_sensor_stale_minutes: string;
  trv_last_seen: string;
  trv_freshness: Exclude<FreshnessMode, "auto">;
};

type PresetValues = Record<PresetKey, string>;
type ControlNumberKey =
  | "cycle_interval_seconds"
  | "heating_offset"
  | "idle_offset"
  | "hysteresis"
  | "frost_protection_temperature"
  | "minimum_boiler_on_minutes"
  | "minimum_boiler_off_minutes"
  | "maximum_boiler_on_minutes"
  | "command_retries"
  | "failures_before_alert"
  | "external_sensor_stale_minutes"
  | "trv_stale_minutes";

type ControlValues = Record<ControlNumberKey, string> & {
  enabled: boolean;
  away_preset: PresetKey;
  smart_temperature_control: boolean;
  open_window_detection: boolean;
  child_lock: boolean;
};
type PreflightCheck = {
  key: string;
  label: string;
  passed: boolean;
  severity: "warning" | "error";
  detail: string;
};
type PreflightResult = { ok: boolean; checks: PreflightCheck[] };
type SettingsScreen = "devices" | "boiler" | "control" | "presets" | "schedules" | "notifications";
type Screen = "dashboard" | "diagnostics" | SettingsScreen;

const DEFAULT_PRESETS: PresetValues = {
  boost: "23",
  comfort: "21",
  eco: "16",
  frost: "5",
};

const DEFAULT_HOT_WATER_SCHEDULE: HotWaterSchedule = {
  default_state: "off",
  periods: [],
};
const DEFAULT_CONTROL: ControlValues = {
  enabled: false,
  away_preset: "frost",
  cycle_interval_seconds: "30",
  heating_offset: "2",
  idle_offset: "2",
  hysteresis: "0.2",
  smart_temperature_control: false,
  open_window_detection: false,
  child_lock: false,
  frost_protection_temperature: "5",
  minimum_boiler_on_minutes: "5",
  minimum_boiler_off_minutes: "5",
  maximum_boiler_on_minutes: "240",
  command_retries: "2",
  failures_before_alert: "3",
  external_sensor_stale_minutes: "90",
  trv_stale_minutes: "60",
};
const ADDON_CONTROL_FIELDS: Array<{
  key: Exclude<ControlNumberKey, "frost_protection_temperature">;
  title: string;
  description: string;
  inputLabel: string;
  min: string;
  max: string;
  step: string;
}> = [
  {
    key: "cycle_interval_seconds",
    title: "Control cycle",
    description: "How often the add-on reads Home Assistant and reconciles heating state.",
    inputLabel: "Seconds",
    min: "10",
    max: "300",
    step: "1",
  },
  {
    key: "hysteresis",
    title: "Start heating below target",
    description: "Start this far below the target; stop as soon as the target is reached.",
    inputLabel: "Degrees °C",
    min: "0",
    max: "2",
    step: "0.1",
  },
  {
    key: "heating_offset",
    title: "Heating offset",
    description: "How far above the effective target to command a TRV while heat is needed.",
    inputLabel: "Degrees °C",
    min: "0.5",
    max: "10",
    step: "0.5",
  },
  {
    key: "idle_offset",
    title: "Idle offset",
    description: "How far below the effective target to command a satisfied TRV.",
    inputLabel: "Degrees °C",
    min: "0.5",
    max: "10",
    step: "0.5",
  },
  {
    key: "minimum_boiler_on_minutes",
    title: "Minimum boiler on time",
    description: "Keep the heating relay on for at least this long to prevent short cycling.",
    inputLabel: "Minutes",
    min: "0",
    max: "60",
    step: "0.5",
  },
  {
    key: "minimum_boiler_off_minutes",
    title: "Minimum boiler off time",
    description: "Wait this long after switch-off before starting the boiler again.",
    inputLabel: "Minutes",
    min: "0",
    max: "60",
    step: "0.5",
  },
  {
    key: "maximum_boiler_on_minutes",
    title: "Maximum continuous boiler run",
    description: "Raise a safety stop if the boiler remains requested for longer than this.",
    inputLabel: "Minutes",
    min: "5",
    max: "360",
    step: "5",
  },
  {
    key: "command_retries",
    title: "Command retries",
    description: "How many times to retry a Home Assistant command that is not confirmed.",
    inputLabel: "Retries",
    min: "0",
    max: "5",
    step: "1",
  },
  {
    key: "failures_before_alert",
    title: "Failed cycles before alert",
    description: "Consecutive failed cycles allowed before reporting a control problem.",
    inputLabel: "Cycles",
    min: "1",
    max: "10",
    step: "1",
  },
  {
    key: "external_sensor_stale_minutes",
    title: "External sensor stale time",
    description: "Fall back to the TRV sensor when the external sensor is older than this.",
    inputLabel: "Minutes",
    min: "5",
    max: "1440",
    step: "5",
  },
  {
    key: "trv_stale_minutes",
    title: "TRV stale time",
    description: "Skip a TRV and exclude it from heat demand after it stops reporting for this long.",
    inputLabel: "Minutes",
    min: "5",
    max: "1440",
    step: "5",
  },
];
const DEFAULT_NOTIFICATIONS: NotificationValues = {
  enabled: false,
  level: "critical",
  send_recovery: true,
  warning_delay_minutes: "15",
};
const CONFIGURED_WEBHOOK_VALUE = "Webhook configured";

function notificationValues(settings: NotificationSettings | undefined): NotificationValues {
  if (!settings) return DEFAULT_NOTIFICATIONS;
  return {
    enabled: settings.enabled,
    level: settings.level,
    send_recovery: settings.send_recovery,
    warning_delay_minutes: String(settings.warning_delay_seconds / 60),
  };
}

function selectionValues(found: Discovery, existing: SavedConfig | null) {
  const existingByDevice = new Map(existing?.trvs.map((trv) => [trv.device_id, trv]));
  const selections: Record<string, Selection> = {};
  for (const trv of found.trvs) {
    const configured = existingByDevice.get(trv.device_id);
    const externalTemperatureSensor =
      configured?.external_temperature_sensor ?? trv.suggested_temperature_sensor ?? "";
    const suggestedExternalLastSeen = found.temperature_sensors.find(
      (sensor) => sensor.entity_id === externalTemperatureSensor,
    )?.suggested_last_seen_entity;
    const externalLastSeen =
      configured?.external_temperature_last_seen ?? suggestedExternalLastSeen ?? "";
    const configuredExternalFreshness = configured?.external_temperature_freshness ?? "auto";
    selections[trv.device_id] = {
      enabled: configured ? true : existing === null,
      room_group: configured?.room_group ?? trv.area_name ?? trv.suggested_group,
      external_temperature_sensor: externalTemperatureSensor,
      external_temperature_last_seen: externalLastSeen,
      external_temperature_freshness:
        configuredExternalFreshness === "auto"
          ? externalLastSeen
            ? "last_seen"
            : "state_updates"
          : configuredExternalFreshness,
      external_sensor_stale_minutes: configured?.external_sensor_stale_seconds
        ? String(configured.external_sensor_stale_seconds / 60)
        : "",
      trv_last_seen: configured?.entities?.last_seen ?? trv.entities.last_seen ?? "",
      trv_freshness:
        configured?.trv_freshness === "auto"
          ? trv.entities.last_seen
            ? "last_seen"
            : "state_updates"
          : configured?.trv_freshness ?? (trv.entities.last_seen ? "last_seen" : "state_updates"),
    };
  }
  return selections;
}

function controlValues(settings: ControlSettings | undefined): ControlValues {
  if (!settings) return DEFAULT_CONTROL;
  return {
    enabled: settings.enabled,
    away_preset: settings.away_preset ?? "frost",
    cycle_interval_seconds: String(settings.cycle_interval_seconds),
    heating_offset: String(settings.heating_offset),
    idle_offset: String(settings.idle_offset),
    hysteresis: String(settings.hysteresis),
    smart_temperature_control: settings.smart_temperature_control,
    open_window_detection: settings.open_window_detection,
    child_lock: settings.child_lock,
    frost_protection_temperature: String(settings.frost_protection_temperature),
    minimum_boiler_on_minutes: String(settings.minimum_boiler_on_seconds / 60),
    minimum_boiler_off_minutes: String(settings.minimum_boiler_off_seconds / 60),
    maximum_boiler_on_minutes: String((settings.maximum_boiler_on_seconds ?? 14400) / 60),
    command_retries: String(settings.command_retries ?? 2),
    failures_before_alert: String(settings.failures_before_alert ?? 3),
    external_sensor_stale_minutes: String((settings.external_sensor_stale_seconds ?? 5400) / 60),
    trv_stale_minutes: String((settings.trv_stale_seconds ?? 3600) / 60),
  };
}

function controlPayload(settings: ControlValues) {
  return {
    enabled: settings.enabled,
    cycle_interval_seconds: Number(settings.cycle_interval_seconds),
    heating_offset: Number(settings.heating_offset),
    idle_offset: Number(settings.idle_offset),
    hysteresis: Number(settings.hysteresis),
    trv_mode: "heat",
    temperature_source: "internal",
    away_preset: settings.away_preset,
    smart_temperature_control: settings.smart_temperature_control,
    open_window_detection: settings.open_window_detection,
    child_lock: settings.child_lock,
    frost_protection_temperature: Number(settings.frost_protection_temperature),
    minimum_boiler_on_seconds: Number(settings.minimum_boiler_on_minutes) * 60,
    minimum_boiler_off_seconds: Number(settings.minimum_boiler_off_minutes) * 60,
    maximum_boiler_on_seconds: Number(settings.maximum_boiler_on_minutes) * 60,
    command_retries: Number(settings.command_retries),
    failures_before_alert: Number(settings.failures_before_alert),
    external_sensor_stale_seconds: Number(settings.external_sensor_stale_minutes) * 60,
    trv_stale_seconds: Number(settings.trv_stale_minutes) * 60,
  };
}

function validateControlValues(settings: ControlValues) {
  for (const field of ADDON_CONTROL_FIELDS) {
    const raw = settings[field.key].trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value)) return `${field.title} must be a number.`;
    if (value < Number(field.min) || value > Number(field.max)) {
      return `${field.title} must be between ${field.min} and ${field.max}.`;
    }
  }
  const frost = settings.frost_protection_temperature.trim();
  const frostValue = Number(frost);
  if (!frost || !Number.isFinite(frostValue)) {
    return "Frost protection temperature must be a number.";
  }
  if (frostValue < 4 || frostValue > 35) {
    return "Frost protection temperature must be between 4°C and 35°C.";
  }
  return "";
}
const HOT_WATER_SCHEDULE_KEY = "__hot_water__";

const PRESET_DEFINITIONS: Array<{ key: PresetKey; name: string; description: string }> = [
  { key: "boost", name: "Boost", description: "Quickly warm a room above its normal target." },
  { key: "comfort", name: "Comfort", description: "The normal temperature for an occupied room." },
  { key: "eco", name: "Eco", description: "Save energy while keeping the room gently heated." },
  { key: "frost", name: "Frost", description: "Protect the room and pipework from freezing." },
];
const HOT_WATER_DEFINITIONS: Array<{ key: HotWaterState; name: string }> = [
  { key: "on", name: "On" },
  { key: "off", name: "Off" },
];

const WEEKDAYS: Array<{ key: Weekday; short: string; name: string }> = [
  { key: "monday", short: "Mon", name: "Monday" },
  { key: "tuesday", short: "Tue", name: "Tuesday" },
  { key: "wednesday", short: "Wed", name: "Wednesday" },
  { key: "thursday", short: "Thu", name: "Thursday" },
  { key: "friday", short: "Fri", name: "Friday" },
  { key: "saturday", short: "Sat", name: "Saturday" },
  { key: "sunday", short: "Sun", name: "Sunday" },
];

const api = (path: string) => `./api/${path}`;
const SETTINGS_SCREENS: SettingsScreen[] = [
  "devices",
  "boiler",
  "control",
  "presets",
  "schedules",
  "notifications",
];

function HomeIcon() {
  return (
    <span slot="icon" className="material-icon">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8h5Z" />
      </svg>
    </span>
  );
}

function SettingsIcon() {
  return (
    <span slot="icon" className="material-icon">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.5.42l-.38 2.65c-.61.25-1.18.59-1.69.98l-2.49-1a.49.49 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.37.3.6.22l2.49-1c.51.39 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.25 1.18-.59 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
      </svg>
    </span>
  );
}

function WarningIcon() {
  return (
    <span className="warning-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor" focusable="false">
        <path d="M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z" />
      </svg>
    </span>
  );
}

function DiagnosticsIcon() {
  return (
    <span slot="icon" className="material-icon">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M3 13h4l2.2-6.6L13 18l2.2-6H21v2h-4.4L13 24 9.1 12.4 8.4 15H3v-2Z" />
      </svg>
    </span>
  );
}

function ThermostatIcon() {
  return (
    <span className="preset-icon preset-custom" title="Custom temperature">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M15 13V5a3 3 0 0 0-6 0v8a5 5 0 1 0 6 0Zm-3 8a3 3 0 0 1-1-5.83V5a1 1 0 0 1 2 0v10.17A3 3 0 0 1 12 21Z" />
      </svg>
      <span className="visually-hidden">Custom temperature</span>
    </span>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="dropdown-chevron" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m7 10 5 5 5-5H7Z" />
    </svg>
  );
}

function ToolbarDropdown({
  id,
  label,
  value,
  open,
  disabled = false,
  options,
  onOpenChange,
}: {
  id: string;
  label: string;
  value: string;
  open: boolean;
  disabled?: boolean;
  options: Array<{
    label: string;
    supportingText?: string;
    selected: boolean;
    onSelect: () => void;
  }>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="toolbar-dropdown">
      <MdOutlinedButton
        id={id}
        type="button"
        className="toolbar-dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${value}`}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        <span className="toolbar-dropdown-trigger-label">
          <span>{label}</span>
          <strong>{value}</strong>
          <ChevronDownIcon />
        </span>
      </MdOutlinedButton>
      <MdMenu
        anchor={id}
        positioning="fixed"
        open={open}
        onClosed={() => onOpenChange(false)}
      >
        {options.map((option) => (
          <MdMenuItem
            type="option"
            selected={option.selected}
            key={option.label}
            onClick={() => {
              onOpenChange(false);
              if (!option.selected) option.onSelect();
            }}
          >
            <span slot="headline">{option.label}</span>
            {option.supportingText && (
              <span slot="supporting-text">{option.supportingText}</span>
            )}
          </MdMenuItem>
        ))}
      </MdMenu>
    </div>
  );
}

function friendlyRole(role: string) {
  return role.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function scheduleValueName(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replace(/^./, (letter) => letter.toUpperCase());
}

const ROOM_STATUS_LABELS: Record<DashboardRoom["status"], string> = {
  heating: "Heating",
  waiting: "Waiting for boiler",
  opening: "Heat requested",
  closing: "Closing",
  idle: "Satisfied",
  stale: "Not recently seen",
  unavailable: "Unavailable",
};

type RelayStatus = "on" | "waiting" | "off" | "unavailable";

const RELAY_STATUS_LABELS: Record<RelayStatus, string> = {
  on: "On",
  waiting: "Waiting to turn on",
  off: "Off",
  unavailable: "Unavailable",
};

function relayStatus(actual: boolean | null, requested: boolean | null): RelayStatus {
  if (actual === null) return "unavailable";
  if (actual) return "on";
  if (requested) return "waiting";
  return "off";
}

function onOffLabel(value: boolean | null) {
  if (value === null) return "Unavailable";
  return value ? "On" : "Off";
}

function optionLabel(option: EntityOption) {
  const context = option.area_name ?? option.device_name;
  const nameAlreadyHasContext =
    context && option.name.toLocaleLowerCase().includes(context.toLocaleLowerCase());
  const prefix = context && !nameAlreadyHasContext ? `${context} · ` : "";
  const state = option.state && option.state !== "unknown" ? ` · ${option.state}${option.unit ?? ""}` : "";
  return `${prefix}${option.name}${state}`;
}

function sensorOptionHeadline(option: EntityOption) {
  const device = option.device_name ?? option.area_name;
  const state = option.state && option.state !== "unknown" ? `${option.state}${option.unit ?? ""}` : null;
  return [device, option.entity_name, state].filter(Boolean).join(" · ");
}

function healthOptionHeadline(option: EntityOption) {
  const device = option.device_name ?? option.area_name;
  const timestamp = option.state ? new Date(option.state) : null;
  const state = timestamp && Number.isFinite(timestamp.getTime())
    ? formatAge(Math.max(0, (Date.now() - timestamp.getTime()) / 1000))
    : option.state;
  return [device, option.entity_name, state].filter(Boolean).join(" · ");
}

function selectionIsConfigured(selection: Selection, discovery: Discovery) {
  if (!selection.enabled || !selection.room_group.trim()) return false;
  if (
    selection.trv_freshness === "last_seen" &&
    (!selection.trv_last_seen ||
      !discovery.health_sensors.some(
        (sensor) => sensor.entity_id === selection.trv_last_seen,
      ))
  ) {
    return false;
  }
  if (!selection.external_temperature_sensor) return true;
  if (
    !discovery.temperature_sensors.some(
      (sensor) => sensor.entity_id === selection.external_temperature_sensor,
    )
  ) {
    return false;
  }
  if (
    selection.external_temperature_freshness === "last_seen" &&
    (!selection.external_temperature_last_seen ||
      !discovery.health_sensors.some(
        (sensor) => sensor.entity_id === selection.external_temperature_last_seen,
      ))
  ) {
    return false;
  }
  if (!selection.external_sensor_stale_minutes) return true;
  const staleMinutes = Number(selection.external_sensor_stale_minutes);
  return Number.isFinite(staleMinutes) && staleMinutes >= 5 && staleMinutes <= 1440;
}

function eventValue(event: Event) {
  return (event.currentTarget as EventTarget & { value: string }).value;
}

function eventChecked(event: Event) {
  return (event.currentTarget as EventTarget & { checked: boolean }).checked;
}

function eventSelected(event: Event) {
  return (event.currentTarget as EventTarget & { selected: boolean }).selected;
}

function roomGroups(config: SavedConfig | null) {
  return [...new Set(config?.trvs.map((trv) => trv.room_group) ?? [])].sort((a, b) =>
    a.localeCompare(b),
  );
}

function schedulesForConfig(config: SavedConfig | null) {
  const existing = new Map(config?.schedules?.map((schedule) => [schedule.room_group, schedule]));
  return roomGroups(config).map(
    (room_group): RoomSchedule =>
      existing.get(room_group) ?? { room_group, default_preset: "eco", periods: [] },
  );
}

function timeMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function validatePeriods(
  schedules: Array<{ name: string; periods: Array<{ days: Weekday[]; start: string; end: string }> }>,
) {
  for (const schedule of schedules) {
    for (const [index, period] of schedule.periods.entries()) {
      if (period.days.length === 0) {
        return `${schedule.name}, period ${index + 1}: choose at least one day.`;
      }
      const start = timeMinutes(period.start);
      const end = timeMinutes(period.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        return `${schedule.name}, period ${index + 1}: the end time must be after the start time.`;
      }
    }
    for (const day of WEEKDAYS) {
      const periods = schedule.periods
        .filter((period) => period.days.includes(day.key))
        .map((period) => ({ start: timeMinutes(period.start), end: timeMinutes(period.end) }))
        .sort((a, b) => a.start - b.start);
      if (periods.some((period, index) => index > 0 && period.start < periods[index - 1].end)) {
        return `${schedule.name}: periods overlap on ${day.name}.`;
      }
    }
  }
  return "";
}

function validateSchedules(schedules: RoomSchedule[], hotWaterSchedule: HotWaterSchedule) {
  return validatePeriods([
    ...schedules.map((schedule) => ({ name: schedule.room_group, periods: schedule.periods })),
    { name: "Hot water", periods: hotWaterSchedule.periods },
  ]);
}

function formatTemperature(value: number | null | undefined, unit: string) {
  if (value == null) return "Unavailable";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}${unit}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatAge(seconds: number | null | undefined) {
  if (seconds == null) return "time unavailable";
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} seconds ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  return `${Math.round(seconds / 3600)} hours ago`;
}

function formatNextScheduleValue(
  room: Pick<DashboardRoom, "next_schedule_at" | "next_preset" | "next_scheduled_temperature"> & {
    unit?: string;
  },
) {
  if (!room.next_schedule_at || !room.next_preset || room.next_scheduled_temperature === null) {
    return "No further change";
  }
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(room.next_schedule_at));
  return `${scheduleValueName(room.next_preset)} · ${formatTemperature(
    room.next_scheduled_temperature,
    room.unit ?? "°C",
  )} · ${when}`;
}

function formatNextHotWaterChange(controller: DashboardData["controller"]) {
  if (!controller.hot_water_next_change_at || !controller.hot_water_next_state) {
    return "None scheduled";
  }
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(controller.hot_water_next_change_at));
  return `${onOffLabel(controller.hot_water_next_state === "on")} · ${when}`;
}

function roomHasDeviceIssue(room: DashboardRoom) {
  return Boolean(room.warning) || room.status === "stale" || room.status === "unavailable";
}

function roomDeviceIssueMessage(room: DashboardRoom) {
  if (room.warning) return room.warning;
  if (room.status === "stale") return "The TRV has not reported recently.";
  if (room.status === "unavailable") return "The TRV or room temperature is unavailable.";
  return null;
}

function TechnicalPill({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <span className="technical-pill" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function ControlSettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="control-setting-row">
      <div className="control-setting-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <div className="control-setting-control">{children}</div>
    </div>
  );
}

function OverrideClockGraphic({ showPlus = false }: { showPlus?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" focusable="false" aria-hidden="true">
      <path d="M11.99 2A10 10 0 1 0 22 12 10 10 0 0 0 11.99 2Zm.01 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm.5-13H11v6l5.2 3.2.8-1.28-4.5-2.67V7Z" />
      {showPlus && <path d="M19 2v3h3v2h-3v3h-2V7h-3V5h3V2h2Z" />}
    </svg>
  );
}

function TemporaryOverrideIcon({ active }: { active: boolean }) {
  return (
    <span slot="icon" className="override-button-icon" aria-hidden="true">
      <OverrideClockGraphic showPlus={!active} />
    </span>
  );
}

function CompactRoomPresetIcon({ room }: { room: DashboardRoom }) {
  if (roomHasDeviceIssue(room)) {
    return (
      <span
        className="preset-icon compact-room-warning-icon"
        title={roomDeviceIssueMessage(room) ?? ROOM_STATUS_LABELS[room.status]}
      >
        <WarningIcon />
        <span className="visually-hidden">Device issue</span>
      </span>
    );
  }
  if (room.control_source === "override" && room.override_mode === "temperature") {
    return <ThermostatIcon />;
  }
  return <PresetIcon preset={room.preset} />;
}

function CompactRoomIcons({ room }: { room: DashboardRoom }) {
  if (room.override_scope_type !== "room") {
    return (
      <span className="compact-room-icons">
        <CompactRoomPresetIcon room={room} />
      </span>
    );
  }
  const label = "Room override active";
  return (
    <span className="compact-room-icons">
      <span className="compact-override-split" title={label}>
        <span className="compact-override-segment" aria-hidden="true">
          <OverrideClockGraphic showPlus />
        </span>
        <span className="compact-preset-segment">
          <CompactRoomPresetIcon room={room} />
        </span>
        <span className="visually-hidden">{label}</span>
      </span>
    </span>
  );
}

function OverrideActionButton({
  active,
  presets,
  targetLabel,
  disabled,
  onClick,
}: {
  active: ActiveTemperatureOverride | ActiveHotWaterOverride | null;
  presets: TemperaturePresets;
  targetLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const summary = active ? overrideSummary(active, presets) : "";
  const visibleLabel = active ? summary : "Override";
  return (
    <MdFilledButton
      type="button"
      className={`compact-override-button ${active ? "is-active" : "is-inactive"}`}
      disabled={disabled}
      title={active ? `Change ${targetLabel} override: ${visibleLabel}` : `Override ${targetLabel}`}
      aria-label={active ? `Change override for ${targetLabel}. ${visibleLabel}` : `Override ${targetLabel}`}
      onClick={onClick}
    >
      <TemporaryOverrideIcon active={Boolean(active)} />
      <span className="override-button-copy">{visibleLabel}</span>
    </MdFilledButton>
  );
}

function DetailCard({
  title,
  subtitle,
  overrideAction,
  status,
  issueMessage,
  primaryReading,
  secondaryReading,
  technical,
}: {
  title: string;
  subtitle?: string;
  overrideAction?: ReactNode;
  status?: ReactNode;
  issueMessage?: string | null;
  primaryReading: { label: ReactNode; value: ReactNode; valueClassName?: string };
  secondaryReading: { label: ReactNode; value: ReactNode; valueClassName?: string };
  technical: ReactNode;
}) {
  return (
    <>
      <div className="room-card-title">
        <div>
          <h3 className="md-typescale-title-large">{title}</h3>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {(overrideAction || status) && (
          <div className="room-card-header-actions">
            {overrideAction && (
              <div className="room-card-override-action">{overrideAction}</div>
            )}
            {status && <div className="room-card-status-action">{status}</div>}
          </div>
        )}
      </div>
      {issueMessage && (
        <div className="room-device-issue" role="alert">
          <WarningIcon />
          <span>{issueMessage}</span>
        </div>
      )}
      <div className="temperature-readings">
        <div className="current-reading">
          <span>{primaryReading.label}</span>
          <strong className={primaryReading.valueClassName}>{primaryReading.value}</strong>
        </div>
        <div className="scheduled-reading">
          <span>{secondaryReading.label}</span>
          <strong className={secondaryReading.valueClassName}>{secondaryReading.value}</strong>
        </div>
      </div>
      <div className="room-technical-state">{technical}</div>
    </>
  );
}

function RoomDetails({
  room,
  onOverride,
  overrideDisabled = false,
  activeOverride = null,
  presets,
}: {
  room: DashboardRoom;
  onOverride?: () => void;
  overrideDisabled?: boolean;
  activeOverride?: ActiveTemperatureOverride | null;
  presets: TemperaturePresets;
}) {
  const issueMessage = roomDeviceIssueMessage(room);
  const scheduledLabel = room.control_source === "boost"
    ? "Boost"
    : room.control_source === "away"
      ? "Away"
      : room.control_source === "override"
        ? "Override"
        : "Scheduled";
  return (
    <DetailCard
      title={room.name}
      subtitle={room.trv_name !== room.name ? room.trv_name : undefined}
      overrideAction={onOverride ? (
        <OverrideActionButton
          active={activeOverride}
          presets={presets}
          targetLabel={room.name}
          disabled={overrideDisabled}
          onClick={onOverride}
        />
      ) : undefined}
      status={(
        <span className={`room-status-badge room-status-${room.status}`}>
          {ROOM_STATUS_LABELS[room.status]}
        </span>
      )}
      issueMessage={issueMessage}
      primaryReading={{
        label: "Actual",
        value: formatTemperature(room.current_temperature, room.unit),
      }}
      secondaryReading={{
        label: scheduledLabel,
        valueClassName: "scheduled-preset-reading",
        value: (
          <>
            {room.control_source === "override" && room.override_mode === "temperature" ? (
              <ThermostatIcon />
            ) : (
              <PresetIcon preset={room.preset} />
            )}
            {formatTemperature(room.scheduled_temperature, room.unit)}
          </>
        ),
      }}
      technical={(
        <>
        <TechnicalPill
          label="TRV command"
          value={formatTemperature(room.commanded_temperature, room.unit)}
        />
        {room.external_temperature !== null && (
          <TechnicalPill
            label="TRV sensor"
            value={formatTemperature(room.trv_temperature, room.unit)}
          />
        )}
        <TechnicalPill
          label="TRV target"
          value={formatTemperature(room.target_temperature, room.unit)}
        />
        {room.external_temperature_freshness === "disabled" ? (
          <TechnicalPill label="Room freshness" value="Disabled" />
        ) : room.external_temperature_health_entity ? (
          <TechnicalPill
            label={
              room.external_temperature_freshness === "state_updates"
                ? "Room temperature updated"
                : "Room sensor last seen"
            }
            value={formatAge(room.external_temperature_age_seconds)}
            title={room.external_temperature_health_entity}
          />
        ) : null}
        {room.trv_last_seen_at && (
          <TechnicalPill
            label="TRV last seen"
            value={formatAge(
              Math.max(0, (Date.now() - new Date(room.trv_last_seen_at).getTime()) / 1000),
            )}
          />
        )}
        <TechnicalPill label="Next schedule" value={formatNextScheduleValue(room)} />
        {room.override_until && (
          <TechnicalPill label="Override ends" value={formatOverrideExpiry(room.override_until)} />
        )}
        </>
      )}
    />
  );
}

function DetailedRoomCard({
  room,
  onOverride,
  overrideDisabled,
  activeOverride,
  presets,
}: {
  room: DashboardRoom;
  onOverride: () => void;
  overrideDisabled: boolean;
  activeOverride: ActiveTemperatureOverride | null;
  presets: TemperaturePresets;
}) {
  return (
    <article
      className={`room-card room-status-${room.status}${roomHasDeviceIssue(room) ? " has-device-issue" : ""}`}
    >
      <RoomDetails
        room={room}
        onOverride={onOverride}
        overrideDisabled={overrideDisabled}
        activeOverride={activeOverride}
        presets={presets}
      />
    </article>
  );
}

function CompactRelayCard({
  name,
  actual,
  status,
  overrideAction,
  onOpen,
}: {
  name: string;
  actual: boolean | null;
  status: RelayStatus;
  overrideAction?: ReactNode;
  onOpen: () => void;
}) {
  return (
    <article
      className={`compact-relay-card relay-status-${status}${status === "unavailable" ? " has-device-issue" : ""}${overrideAction ? " has-override-action" : ""}`}
    >
      <button
        type="button"
        className="compact-relay-card-open"
        aria-label={`Open details for ${name}`}
        onClick={onOpen}
      />
      <span>{name}</span>
      <strong>{onOffLabel(actual)}</strong>
      {overrideAction}
    </article>
  );
}

function RelayDetails({
  name,
  actual,
  requested,
  technicalLabel,
  technicalValue,
  overrideAction,
}: {
  name: string;
  actual: boolean | null;
  requested: boolean | null;
  technicalLabel: string;
  technicalValue: string;
  overrideAction: ReactNode;
}) {
  return (
    <DetailCard
      title={name}
      overrideAction={overrideAction}
      primaryReading={{ label: "Actual", value: onOffLabel(actual) }}
      secondaryReading={{ label: "Requested", value: onOffLabel(requested) }}
      technical={<TechnicalPill label={technicalLabel} value={technicalValue} />}
    />
  );
}

function relayState(value: boolean | null, configured: boolean) {
  if (!configured) return "Not configured";
  if (value === null) return "Unavailable";
  return value ? "On" : "Off";
}

function diagnosticStatusLabel(status: DiagnosticsData["overall_status"]) {
  return {
    monitoring: "Monitoring only",
    running: "Running normally",
    warning: "Needs attention",
    error: "Control error",
  }[status];
}

function formatOverrideExpiry(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

function activeOverrideFor(
  dashboard: DashboardData,
  target: OverrideTarget,
): ActiveTemperatureOverride | ActiveHotWaterOverride | null {
  if (target.channel === "hot_water") return dashboard.overrides.hot_water_override ?? null;
  return (dashboard.overrides.temperature_overrides ?? []).find(
    (override) =>
      override.scope_type === target.scopeType && override.scope_id === target.scopeId,
  ) ?? null;
}

function temperatureOverrideFor(
  dashboard: DashboardData,
  scopeType: "house" | "group" | "room",
  scopeId: string | null,
) {
  return (dashboard.overrides.temperature_overrides ?? []).find(
    (override) => override.scope_type === scopeType && override.scope_id === scopeId,
  ) ?? null;
}

function overrideSummary(
  override: ActiveTemperatureOverride | ActiveHotWaterOverride | null,
  presets: TemperaturePresets,
) {
  if (!override) return "No temporary override";
  const expiry = override.expires_at
    ? ` until ${formatOverrideExpiry(override.expires_at)}`
    : " until cancelled";
  if ("on" in override) return `${override.on ? "On" : "Off"}${expiry}`;
  if (override.override_mode === "preset" && override.preset) {
    return `${scheduleValueName(override.preset)} · ${formatTemperature(presets[override.preset], "°C")}${expiry}`;
  }
  return `${formatTemperature(override.temperature, "°C")}${expiry}`;
}

function overrideScopeLabel(
  override: ActiveTemperatureOverride | ActiveHotWaterOverride,
  rooms: DiagnosticRoom[],
) {
  if ("on" in override) return "Hot water";
  if (override.scope_type === "house") return "Whole house";
  if (override.scope_type === "group") return override.scope_id ?? "Unknown group";
  return rooms.find((room) => room.device_id === override.scope_id)?.name ?? override.scope_id ?? "Unknown room";
}

function overrideActorLabel(override: ActiveTemperatureOverride | ActiveHotWaterOverride) {
  const actor = override.actor_name ?? override.actor_user_id;
  return actor ? `${actor} via ${override.source}` : override.source;
}

function appliedOverrideForRoom(
  room: DiagnosticRoom,
  overrides: ActiveTemperatureOverride[],
) {
  if (!room.override_scope_type) return null;
  return overrides.find(
    (override) =>
      override.scope_type === room.override_scope_type &&
      override.scope_id === room.override_scope_id,
  ) ?? null;
}

export default function App() {
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [saved, setSaved] = useState<SavedConfig | null>(null);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set());
  const [boilerSwitch, setBoilerSwitch] = useState("");
  const [hotWaterSwitch, setHotWaterSwitch] = useState("");
  const [minimumHeatRequests, setMinimumHeatRequests] = useState("1");
  const [control, setControl] = useState<ControlValues>(DEFAULT_CONTROL);
  const [presets, setPresets] = useState<PresetValues>(DEFAULT_PRESETS);
  const [schedules, setSchedules] = useState<RoomSchedule[]>([]);
  const [hotWaterSchedule, setHotWaterSchedule] = useState<HotWaterSchedule>(
    DEFAULT_HOT_WATER_SCHEDULE,
  );
  const [notifications, setNotifications] = useState<NotificationValues>(DEFAULT_NOTIFICATIONS);
  const [discordWebhook, setDiscordWebhook] = useState("");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [detailedDashboard, setDetailedDashboard] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [selectedDashboardRoomId, setSelectedDashboardRoomId] = useState<string | null>(null);
  const [selectedDashboardRelay, setSelectedDashboardRelay] = useState<"heating" | "hot_water" | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [selectedRoomGroup, setSelectedRoomGroup] = useState("");
  const [screen, setScreen] = useState<Screen>("devices");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [presetError, setPresetError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [emergencyConfirming, setEmergencyConfirming] = useState(false);
  const [emergencyStopping, setEmergencyStopping] = useState(false);
  const [acknowledgingFault, setAcknowledgingFault] = useState(false);
  const [testingNotifications, setTestingNotifications] = useState(false);
  const [overrideSaving, setOverrideSaving] = useState("");
  const selectedDashboardRoom = useMemo(
    () =>
      dashboard?.groups
        .flatMap((group) => group.rooms)
        .find((room) => room.device_id === selectedDashboardRoomId) ?? null,
    [dashboard, selectedDashboardRoomId],
  );
  const activeOverride = useMemo(
    () => dashboard && overrideTarget ? activeOverrideFor(dashboard, overrideTarget) : null,
    [dashboard, overrideTarget],
  );

  async function load(
    openSettings = false,
    settingsScreen: SettingsScreen = "devices",
  ) {
    setLoading(true);
    setError("");
    try {
      const configResponse = await fetch(api("config"));
      const configBody = await configResponse.json();
      if (!configResponse.ok) throw new Error(configBody.error || "Could not load configuration");

      const existing = (configBody.config ?? null) as SavedConfig | null;
      const nextSchedules = schedulesForConfig(existing);
      setSaved(existing);
      setPresets({
        boost: String(existing?.presets?.boost ?? DEFAULT_PRESETS.boost),
        comfort: String(existing?.presets?.comfort ?? DEFAULT_PRESETS.comfort),
        eco: String(existing?.presets?.eco ?? DEFAULT_PRESETS.eco),
        frost: String(existing?.presets?.frost ?? DEFAULT_PRESETS.frost),
      });
      setSchedules(nextSchedules);
      setHotWaterSchedule(existing?.hot_water_schedule ?? DEFAULT_HOT_WATER_SCHEDULE);
      setControl(controlValues(existing?.control));
      setNotifications(notificationValues(existing?.notifications));
      setDiscordWebhook(
        existing?.notifications?.discord_webhook_configured ? CONFIGURED_WEBHOOK_VALUE : "",
      );
      setPreflight(null);
      setSelectedRoomGroup(nextSchedules[0]?.room_group ?? "");

      if (existing?.setup.schedules && !openSettings) {
        setScreen("dashboard");
        await loadDashboard();
        return;
      }

      const discoveryResponse = await fetch(api("onboarding/discovery"));
      const discoveryBody = await discoveryResponse.json();
      if (!discoveryResponse.ok) throw new Error(discoveryBody.error || "Discovery failed");
      const found = {
        ...discoveryBody,
        health_sensors: discoveryBody.health_sensors ?? [],
      } as Discovery;
      const existingByDevice = new Map(existing?.trvs.map((trv) => [trv.device_id, trv]));
      const nextSelections = selectionValues(found, existing);
      setDiscovery(found);
      setScreen(
        openSettings
          ? settingsScreen
          : existing && !existing.setup.boiler
            ? "boiler"
            : existing
              ? "schedules"
              : "devices",
      );
      setSelections(nextSelections);
      setExpandedDevices(
        new Set(
          found.trvs
            .filter((trv) => {
              const configured = existingByDevice.has(trv.device_id);
              return !configured || !selectionIsConfigured(nextSelections[trv.device_id], found);
            })
            .map((trv) => trv.device_id),
        ),
      );
      setBoilerSwitch(existing?.boiler_switch ?? found.suggested.boiler_switch ?? "");
      setHotWaterSwitch(existing?.hot_water_switch ?? found.suggested.hot_water_switch ?? "");
      setMinimumHeatRequests(String(existing?.minimum_heat_requests ?? 1));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (screen !== "dashboard") return;
    const interval = window.setInterval(() => void loadDashboard(true), 30_000);
    return () => window.clearInterval(interval);
  }, [screen]);

  useEffect(() => {
    if (screen !== "diagnostics") return;
    const interval = window.setInterval(() => void loadDiagnostics(true), 30_000);
    return () => window.clearInterval(interval);
  }, [screen]);

  const selectedCount = useMemo(
    () => Object.values(selections).filter((selection) => selection.enabled).length,
    [selections],
  );
  const maximumHeatRequests = Math.max(1, saved?.trvs.length ?? selectedCount);
  const minimumHeatRequestsNumber = Number(minimumHeatRequests);
  const minimumHeatRequestsValid =
    Number.isInteger(minimumHeatRequestsNumber) &&
    minimumHeatRequestsNumber >= 1 &&
    minimumHeatRequestsNumber <= maximumHeatRequests;
  const warningDelayMinutes = Number(notifications.warning_delay_minutes);
  const discordWebhookChanged =
    Boolean(discordWebhook) && discordWebhook !== CONFIGURED_WEBHOOK_VALUE;
  const notificationSettingsValid =
    Number.isFinite(warningDelayMinutes) &&
    warningDelayMinutes >= 1 &&
    warningDelayMinutes <= 1440 &&
    (!notifications.enabled ||
      Boolean(saved?.notifications?.discord_webhook_configured || discordWebhookChanged));
  const setupComplete = saved?.setup.schedules ?? false;
  const dashboardPresets: TemperaturePresets = saved?.presets ?? {
    boost: Number(DEFAULT_PRESETS.boost),
    comfort: Number(DEFAULT_PRESETS.comfort),
    eco: Number(DEFAULT_PRESETS.eco),
    frost: Number(DEFAULT_PRESETS.frost),
  };
  const visibleError =
    screen === "diagnostics"
      ? diagnosticsError
      : screen === "presets"
      ? presetError || error
      : screen === "schedules"
        ? scheduleError || error
        : error;
  const selectedSchedule = schedules.find(
    (schedule) => schedule.room_group === selectedRoomGroup,
  );
  const editingHotWater = selectedRoomGroup === HOT_WATER_SCHEDULE_KEY;
  const activeScheduleName = editingHotWater ? "Hot water" : selectedSchedule?.room_group ?? "";
  const activeDefaultValue = editingHotWater
    ? hotWaterSchedule.default_state
    : selectedSchedule?.default_preset ?? "eco";
  const activePeriods = editingHotWater
    ? hotWaterSchedule.periods.map((period) => ({ ...period, value: period.state }))
    : (selectedSchedule?.periods ?? []).map((period) => ({ ...period, value: period.preset }));
  const activeDefinitions = editingHotWater ? HOT_WATER_DEFINITIONS : PRESET_DEFINITIONS;
  const faultLatched =
    screen === "dashboard"
      ? dashboard?.controller.fault_latched ?? saved?.safety?.fault_latched ?? false
      : screen === "diagnostics"
        ? diagnostics?.controller.fault_latched ?? saved?.safety?.fault_latched ?? false
        : saved?.safety?.fault_latched ?? false;
  const controlEnabled =
    screen === "dashboard"
      ? dashboard?.controller.enabled ?? saved?.control.enabled ?? false
      : screen === "diagnostics"
        ? diagnostics?.controller.enabled ?? saved?.control.enabled ?? false
        : saved?.control.enabled ?? false;

  function updateSelection(deviceId: string, patch: Partial<Selection>) {
    setSelections((current) => ({
      ...current,
      [deviceId]: { ...current[deviceId], ...patch },
    }));
    setNotice("");
  }

  function showScreen(nextScreen: Screen) {
    setScreen(nextScreen);
    setError("");
    setNotice("");
    setPresetError("");
    setScheduleError("");
    setDiagnosticsError("");
  }

  function revertSettings(settingsScreen: SettingsScreen) {
    setError("");
    setNotice("");
    setPresetError("");
    setScheduleError("");
    setPreflight(null);

    if (settingsScreen === "devices" && discovery) {
      setSelections(selectionValues(discovery, saved));
      setExpandedDevices(new Set());
    } else if (settingsScreen === "boiler") {
      setBoilerSwitch(saved?.boiler_switch ?? "");
      setHotWaterSwitch(saved?.hot_water_switch ?? "");
      setMinimumHeatRequests(String(saved?.minimum_heat_requests ?? 1));
    } else if (settingsScreen === "control") {
      setControl(controlValues(saved?.control));
    } else if (settingsScreen === "presets") {
      setPresets({
        boost: String(saved?.presets?.boost ?? DEFAULT_PRESETS.boost),
        comfort: String(saved?.presets?.comfort ?? DEFAULT_PRESETS.comfort),
        eco: String(saved?.presets?.eco ?? DEFAULT_PRESETS.eco),
        frost: String(saved?.presets?.frost ?? DEFAULT_PRESETS.frost),
      });
    } else if (settingsScreen === "schedules") {
      const restoredSchedules = schedulesForConfig(saved);
      setSchedules(restoredSchedules);
      setHotWaterSchedule(saved?.hot_water_schedule ?? DEFAULT_HOT_WATER_SCHEDULE);
      setSelectedRoomGroup((current) =>
        restoredSchedules.some((schedule) => schedule.room_group === current)
          ? current
          : restoredSchedules[0]?.room_group ?? "",
      );
    } else if (settingsScreen === "notifications") {
      setNotifications(notificationValues(saved?.notifications));
      setDiscordWebhook(
        saved?.notifications?.discord_webhook_configured ? CONFIGURED_WEBHOOK_VALUE : "",
      );
    }
  }

  function changeAppTab(event: Event) {
    const index = (event.currentTarget as EventTarget & { activeTabIndex: number })
      .activeTabIndex;
    if (index === 0) {
      showScreen("dashboard");
      void loadDashboard();
    } else if (index === 1) {
      void load(true);
    } else if (index === 2) {
      showScreen("diagnostics");
      void loadDiagnostics();
    }
  }

  function updatePreset(key: PresetKey, value: string) {
    setPresets((current) => ({ ...current, [key]: value }));
    setNotice("");
    setPresetError("");
  }

  function updateControl(patch: Partial<ControlValues>) {
    setControl((current) => ({ ...current, ...patch }));
    setPreflight(null);
    setNotice("");
  }

  async function runPreflight(settings: ControlValues) {
    setPreflightLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("control/preflight"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(controlPayload(settings)),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not check automatic control");
      setPreflight(body as PreflightResult);
      return body as PreflightResult;
    } catch (reason) {
      setPreflight(null);
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setPreflightLoading(false);
    }
  }

  function toggleAutomaticControl(enabled: boolean) {
    const next = { ...control, enabled };
    setControl(next);
    setPreflight(null);
    setNotice("");
    if (enabled && !saved?.control.enabled) void runPreflight(next);
  }

  async function emergencyStop() {
    setEmergencyStopping(true);
    setError("");
    setDiagnosticsError("");
    setNotice("");
    try {
      const response = await fetch(api("control/emergency-stop"), { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Emergency stop could not be confirmed");
      const config = body.config as SavedConfig;
      setSaved(config);
      setControl(controlValues(config.control));
      setPreflight(null);
      setEmergencyConfirming(false);
      await Promise.all([loadDashboard(true), loadDiagnostics(true)]);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (screen === "diagnostics") setDiagnosticsError(message);
      else setError(message);
      await Promise.all([loadDashboard(true), loadDiagnostics(true)]);
    } finally {
      setEmergencyStopping(false);
    }
  }

  async function acknowledgeFault() {
    setAcknowledgingFault(true);
    setDiagnosticsError("");
    try {
      const response = await fetch(api("control/fault/acknowledge"), { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not acknowledge the safety stop");
      const config = body.config as SavedConfig;
      setSaved(config);
      setControl(controlValues(config.control));
      await Promise.all([loadDashboard(true), loadDiagnostics(true)]);
    } catch (reason) {
      setDiagnosticsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAcknowledgingFault(false);
    }
  }

  async function loadDashboard(silent = false) {
    if (!silent) setDashboardLoading(true);
    try {
      const response = await fetch(api("dashboard"));
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load the dashboard");
      setDashboard(body as DashboardData);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!silent) setDashboardLoading(false);
    }
  }

  async function loadDiagnostics(silent = false) {
    if (!silent) setDiagnosticsLoading(true);
    try {
      const response = await fetch(api("diagnostics"));
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load diagnostics");
      setDiagnostics(body as DiagnosticsData);
      setDiagnosticsError("");
    } catch (reason) {
      setDiagnosticsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!silent) setDiagnosticsLoading(false);
    }
  }

  async function setHeatingMode(mode: "home" | "away") {
    setOverrideSaving(`mode:${mode}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("mode"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not change heating mode");
      await loadDashboard(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOverrideSaving("");
    }
  }

  async function saveOverride(payload: OverrideActionPayload) {
    const target = overrideTarget;
    if (!target) return;
    const targetKey = `${target.channel}:${target.scopeType}:${target.scopeId ?? "all"}`;
    setOverrideSaving(targetKey);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("overrides/actions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save override");
      setOverrideTarget(null);
      await loadDashboard(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOverrideSaving("");
    }
  }

  async function clearOverride(payload: OverrideActionPayload) {
    const target = overrideTarget;
    if (!target) return;
    const targetKey = `${target.channel}:${target.scopeType}:${target.scopeId ?? "all"}`;
    setOverrideSaving(targetKey);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("overrides/actions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not cancel override");
      setOverrideTarget(null);
      await loadDashboard(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOverrideSaving("");
    }
  }

  function updateRoomSchedule(roomGroup: string, update: (schedule: RoomSchedule) => RoomSchedule) {
    setSchedules((current) =>
      current.map((schedule) =>
        schedule.room_group === roomGroup ? update(schedule) : schedule,
      ),
    );
    setNotice("");
    setScheduleError("");
  }

  function updateHotWaterSchedule(update: (schedule: HotWaterSchedule) => HotWaterSchedule) {
    setHotWaterSchedule((current) => update(current));
    setNotice("");
    setScheduleError("");
  }

  function updateDefaultScheduleValue(value: string) {
    if (editingHotWater) {
      updateHotWaterSchedule((schedule) => ({
        ...schedule,
        default_state: value as HotWaterState,
      }));
    } else if (selectedSchedule) {
      updateRoomSchedule(selectedSchedule.room_group, (schedule) => ({
        ...schedule,
        default_preset: value as PresetKey,
      }));
    }
  }

  function addPeriod() {
    if (editingHotWater) {
      updateHotWaterSchedule((schedule) => ({
        ...schedule,
        periods: [
          ...schedule.periods,
          {
            days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
            start: "06:30",
            end: "08:30",
            state: "on",
          },
        ],
      }));
      return;
    }
    if (!selectedSchedule) return;
    updateRoomSchedule(selectedSchedule.room_group, (schedule) => ({
      ...schedule,
      periods: [
        ...schedule.periods,
        {
          days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          start: "06:30",
          end: "08:30",
          preset: "comfort",
        },
      ],
    }));
  }

  function updatePeriod(
    index: number,
    patch: Partial<{ days: Weekday[]; start: string; end: string; value: PresetKey | HotWaterState }>,
  ) {
    const { value, ...commonPatch } = patch;
    if (editingHotWater) {
      updateHotWaterSchedule((schedule) => ({
        ...schedule,
        periods: schedule.periods.map((period, periodIndex) =>
          periodIndex === index
            ? { ...period, ...commonPatch, ...(value ? { state: value as HotWaterState } : {}) }
            : period,
        ),
      }));
      return;
    }
    if (!selectedSchedule) return;
    updateRoomSchedule(selectedSchedule.room_group, (schedule) => ({
      ...schedule,
      periods: schedule.periods.map((period, periodIndex) =>
        periodIndex === index
          ? { ...period, ...commonPatch, ...(value ? { preset: value as PresetKey } : {}) }
          : period,
      ),
    }));
  }

  function removePeriod(index: number) {
    if (editingHotWater) {
      updateHotWaterSchedule((schedule) => ({
        ...schedule,
        periods: schedule.periods.filter((_, periodIndex) => periodIndex !== index),
      }));
      return;
    }
    if (!selectedSchedule) return;
    updateRoomSchedule(selectedSchedule.room_group, (schedule) => ({
      ...schedule,
      periods: schedule.periods.filter((_, periodIndex) => periodIndex !== index),
    }));
  }

  function togglePeriodDay(index: number, day: Weekday) {
    const period = activePeriods[index];
    if (!period) return;
    updatePeriod(index, {
      days: period.days.includes(day)
        ? period.days.filter((existing) => existing !== day)
        : WEEKDAYS.map((item) => item.key).filter(
            (candidate) => candidate === day || period.days.includes(candidate),
          ),
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!discovery) return;
    setSaving(true);
    setError("");
    setNotice("");
    const trvs = discovery.trvs
      .filter((trv) => selections[trv.device_id]?.enabled)
      .map((trv) => ({
        device_id: trv.device_id,
        room_group: selections[trv.device_id].room_group.trim(),
        external_temperature_sensor:
          selections[trv.device_id].external_temperature_sensor || null,
        external_temperature_last_seen:
          selections[trv.device_id].external_temperature_freshness === "last_seen"
            ? selections[trv.device_id].external_temperature_last_seen || null
            : null,
        external_temperature_freshness:
          selections[trv.device_id].external_temperature_freshness,
        external_sensor_stale_seconds: selections[trv.device_id].external_sensor_stale_minutes
          ? Number(selections[trv.device_id].external_sensor_stale_minutes) * 60
          : null,
        trv_last_seen:
          selections[trv.device_id].trv_freshness === "last_seen"
            ? selections[trv.device_id].trv_last_seen || null
            : null,
        trv_freshness: selections[trv.device_id].trv_freshness,
      }));
    try {
      const response = await fetch(api("onboarding"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trvs }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save configuration");
      const config = body.config as SavedConfig;
      const nextSchedules = schedulesForConfig(config);
      setSaved(config);
      setControl(controlValues(config.control));
      setSchedules(nextSchedules);
      setHotWaterSchedule(config.hot_water_schedule ?? DEFAULT_HOT_WATER_SCHEDULE);
      setSelectedRoomGroup((current) =>
        nextSchedules.some((schedule) => schedule.room_group === current)
          ? current
          : nextSchedules[0]?.room_group ?? "",
      );
      setNotice("Configuration saved and verified against Home Assistant.");
      setExpandedDevices(new Set());
      if (!setupComplete) setScreen("boiler");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveBoiler(event: FormEvent) {
    event.preventDefault();
    await persistBoilerSettings(false);
  }

  async function persistBoilerSettings(skip: boolean) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("boiler"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boiler_switch: skip ? null : boilerSwitch || null,
          hot_water_switch: skip ? null : hotWaterSwitch || null,
          minimum_heat_requests: skip ? 1 : Number(minimumHeatRequests),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save boiler settings");
      const config = body.config as SavedConfig;
      setSaved(config);
      setControl(controlValues(config.control));
      setBoilerSwitch(config.boiler_switch ?? "");
      setHotWaterSwitch(config.hot_water_switch ?? "");
      setMinimumHeatRequests(String(config.minimum_heat_requests));
      if (!skip) {
        setNotice("Boiler settings saved.");
      }
      if (!setupComplete) setScreen("schedules");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveControl(event: FormEvent) {
    event.preventDefault();
    const validationError = validateControlValues(control);
    if (validationError) {
      setError(validationError);
      setNotice("");
      return;
    }
    if (control.enabled && !saved?.control.enabled && !preflight?.ok) {
      await runPreflight(control);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("control"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(controlPayload(control)),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.preflight) setPreflight(body.preflight as PreflightResult);
        throw new Error(body.error || "Could not save control settings");
      }
      const config = body.config as SavedConfig;
      setSaved(config);
      setControl(controlValues(config.control));
      setPreflight(null);
      if (body.status === "faulted") {
        setError(
          config.safety.fault_reason ||
            "Automatic control stopped because a command could not be confirmed.",
        );
      } else {
        setNotice("Control settings saved successfully.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function savePresets(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPresetError("");
    const values = {
      boost: Number(presets.boost),
      comfort: Number(presets.comfort),
      eco: Number(presets.eco),
      frost: Number(presets.frost),
    };
    if (!(values.boost > values.comfort && values.comfort > values.eco && values.eco > values.frost)) {
      setPresetError("Temperatures must descend from Boost to Frost.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(api("presets"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save presets");
      const config = body.config as SavedConfig;
      setSaved(config);
      setControl(controlValues(config.control));
      setNotice("Presets saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveSchedules(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setScheduleError("");
    const validationError = validateSchedules(schedules, hotWaterSchedule);
    if (validationError) {
      setScheduleError(validationError);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(api("schedules"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedules, hot_water_schedule: hotWaterSchedule }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save schedules");
      const config = body.config as SavedConfig;
      setSaved(config);
      setControl(controlValues(config.control));
      setHotWaterSchedule(config.hot_water_schedule ?? DEFAULT_HOT_WATER_SCHEDULE);
      setNotice("Schedules saved.");
      setScreen("dashboard");
      await loadDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveNotifications(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("notifications"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: notifications.enabled,
          discord_webhook_url: discordWebhookChanged ? discordWebhook : null,
          clear_webhook: false,
          level: notifications.level,
          send_recovery: notifications.send_recovery,
          warning_delay_seconds: Number(notifications.warning_delay_minutes) * 60,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save notification settings");
      const config = body.config as SavedConfig;
      setSaved(config);
      setNotifications(notificationValues(config.notifications));
      setDiscordWebhook(
        config.notifications.discord_webhook_configured ? CONFIGURED_WEBHOOK_VALUE : "",
      );
      setNotice("Notification settings saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function removeDiscordWebhook() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("notifications"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: false,
          discord_webhook_url: null,
          clear_webhook: true,
          level: notifications.level,
          send_recovery: notifications.send_recovery,
          warning_delay_seconds: Number(notifications.warning_delay_minutes) * 60,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not remove the Discord webhook");
      const config = body.config as SavedConfig;
      setSaved(config);
      setNotifications(notificationValues(config.notifications));
      setDiscordWebhook("");
      setNotice("Discord webhook removed and notifications disabled.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function testNotifications() {
    setTestingNotifications(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("notifications/test"), { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not send the test notification");
      setNotice("Test notification sent to Discord.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTestingNotifications(false);
    }
  }

  if (loading) {
    return <main id="app-top" className="shell"><div className="loading">Discovering the heating system…</div></main>;
  }

  return (
    <main id="app-top" className="shell">
      <div className="app-heading">
        <div className="app-brand">
          <img src={heatStewardIcon} alt="Heat Steward" />
        </div>
        <div
          className={`status ${
            faultLatched
              ? "fault"
              : setupComplete
                ? "configured"
                : saved
                  ? "progress"
                  : "draft"
          }`}
        >
          <span className="status-dot" />
          {faultLatched
            ? "Safety stop"
            : setupComplete
              ? controlEnabled
                ? "Running"
                : "Monitoring"
              : saved
                ? "Setup in progress"
                : "Not configured"}
        </div>
        {(screen === "dashboard" || screen === "diagnostics") && (
          <div className="dashboard-actions">
            {screen === "dashboard" && dashboard && (
              <ToolbarDropdown
                id="heating-mode-menu-trigger"
                label="Mode"
                value={dashboard.overrides.mode === "home" ? "Home" : "Away"}
                open={modeMenuOpen}
                disabled={Boolean(overrideSaving)}
                onOpenChange={setModeMenuOpen}
                options={[
                  {
                    label: "Home",
                    supportingText: "Follow room schedules",
                    selected: dashboard.overrides.mode === "home",
                    onSelect: () => void setHeatingMode("home"),
                  },
                  {
                    label: "Away",
                    supportingText: `Use ${scheduleValueName(dashboard.overrides.away_preset)} throughout`,
                    selected: dashboard.overrides.mode === "away",
                    onSelect: () => void setHeatingMode("away"),
                  },
                ]}
              />
            )}
            {screen === "dashboard" && (
              <ToolbarDropdown
                id="dashboard-view-menu-trigger"
                label="View"
                value={detailedDashboard ? "Detailed" : "Compact"}
                open={viewMenuOpen}
                onOpenChange={setViewMenuOpen}
                options={[
                  {
                    label: "Compact",
                    supportingText: "Show room summaries",
                    selected: !detailedDashboard,
                    onSelect: () => setDetailedDashboard(false),
                  },
                  {
                    label: "Detailed",
                    supportingText: "Show temperatures and technical details",
                    selected: detailedDashboard,
                    onSelect: () => setDetailedDashboard(true),
                  },
                ]}
              />
            )}
            <MdOutlinedButton
              type="button"
              className="emergency-button"
              disabled={emergencyStopping}
              onClick={() => setEmergencyConfirming(true)}
            >
              Emergency stop
            </MdOutlinedButton>
            <MdOutlinedButton
              type="button"
              disabled={screen === "dashboard" ? dashboardLoading : diagnosticsLoading}
              onClick={() =>
                screen === "dashboard" ? void loadDashboard() : void loadDiagnostics()
              }
            >
              {(screen === "dashboard" ? dashboardLoading : diagnosticsLoading)
                ? "Refreshing…"
                : "Refresh"}
            </MdOutlinedButton>
            {screen === "diagnostics" && (
              <MdOutlinedButton
                type="button"
                onClick={() => window.location.assign(api("diagnostics/export"))}
              >
                Download diagnostics
              </MdOutlinedButton>
            )}
          </div>
        )}
      </div>
      {setupComplete && (
        <MdTabs
          className="app-tabs"
          activeTabIndex={screen === "dashboard" ? 0 : screen === "diagnostics" ? 2 : 1}
          onChange={changeAppTab}
          aria-label="Heat Steward"
        >
          <MdPrimaryTab hasIcon active={screen === "dashboard"}>
            <HomeIcon />
            Dashboard
          </MdPrimaryTab>
          <MdPrimaryTab
            hasIcon
            active={screen !== "dashboard" && screen !== "diagnostics"}
          >
            <SettingsIcon />
            Settings
          </MdPrimaryTab>
          <MdPrimaryTab hasIcon active={screen === "diagnostics"}>
            <DiagnosticsIcon />
            Diagnostics
          </MdPrimaryTab>
        </MdTabs>
      )}
      {emergencyConfirming && (screen === "dashboard" || screen === "diagnostics") && (
        <section className="emergency-confirmation" role="alert">
          <WarningIcon />
          <div>
            <strong>Disable automatic control and turn both relays off?</strong>
            <p>
              This sends explicit off commands to the configured heating and hot-water relays.
            </p>
          </div>
          <div className="emergency-confirmation-actions">
            <MdTextButton
              type="button"
              disabled={emergencyStopping}
              onClick={() => setEmergencyConfirming(false)}
            >
              Cancel
            </MdTextButton>
            <MdFilledButton
              type="button"
              className="emergency-confirm-button"
              disabled={emergencyStopping}
              onClick={() => void emergencyStop()}
            >
              {emergencyStopping ? "Stopping…" : "Disable control and turn off"}
            </MdFilledButton>
          </div>
        </section>
      )}

      {discovery && screen !== "dashboard" && screen !== "diagnostics" &&
        (setupComplete ? (
          <nav
            className="config-tabs"
            role="tablist"
            aria-label="Heating configuration"
          >
            {SETTINGS_SCREENS.map((settingsScreen) => (
              <button
                type="button"
                role="tab"
                className={`config-tab${screen === settingsScreen ? " active" : ""}`}
                aria-selected={screen === settingsScreen}
                tabIndex={screen === settingsScreen ? 0 : -1}
                key={settingsScreen}
                onClick={() => showScreen(settingsScreen)}
              >
                {settingsScreen === "devices" ? "Radiators" : scheduleValueName(settingsScreen)}
              </button>
            ))}
          </nav>
        ) : (
          <ol className="onboarding-progress" aria-label="Onboarding progress">
            <li className={screen === "devices" ? "active" : "complete"}>
              <span>1</span>
              Radiators
            </li>
            <li
              className={
                screen === "boiler"
                  ? "active"
                  : screen === "schedules" || saved?.setup.boiler
                    ? "complete"
                    : "pending"
              }
            >
              <span>2</span>
              Boiler
            </li>
            <li className={screen === "schedules" ? "active" : "pending"}>
              <span>3</span>
              Schedules
            </li>
          </ol>
        ))}

      {visibleError && (
        <div className="message error"><strong>Couldn’t continue.</strong> {visibleError}</div>
      )}
      {notice && screen !== "dashboard" && screen !== "diagnostics" && (
        <div className="message success">{notice}</div>
      )}

      {screen === "dashboard" ? (
        <section className="dashboard" aria-live="polite">
          {dashboardLoading && !dashboard ? (
            <div className="loading">Loading room temperatures…</div>
          ) : dashboard ? (
            <div className="dashboard-content">
              {!dashboard.controller.enabled && (
                <section className="monitoring-warning" role="status">
                  <WarningIcon />
                  <strong>Monitoring only: TRVs will not be controlled</strong>
                  <MdTextButton type="button" onClick={() => void load(true, "control")}>
                    Control settings
                  </MdTextButton>
                </section>
              )}
              {dashboard.issues.length > 0 && (
                <section className="dashboard-issues" aria-label="Current issues">
                  {dashboard.issues.map((issue, index) => (
                    <article
                      className={`diagnostic-issue ${issue.severity}`}
                      key={`${issue.title}-${index}`}
                    >
                      <WarningIcon />
                      <div>
                        <strong>{issue.title}</strong>
                        <p>{issue.detail}</p>
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {(saved?.boiler_switch || saved?.hot_water_switch) && (
                <section className="room-group relay-status-group">
                  <div
                    className={`room-grid relay-status-grid ${detailedDashboard ? "" : "compact-relay-grid"}`}
                  >
                    {saved.boiler_switch && (() => {
                      const status = relayStatus(
                        dashboard.controller.boiler_is_on,
                        dashboard.controller.boiler_should_be_on,
                      );
                      const override = temperatureOverrideFor(dashboard, "house", null);
                      if (!detailedDashboard) {
                        return (
                          <CompactRelayCard
                            name="Central heating"
                            actual={dashboard.controller.boiler_is_on}
                            status={status}
                            onOpen={() => setSelectedDashboardRelay("heating")}
                            overrideAction={(
                              <OverrideActionButton
                                active={override}
                                presets={dashboardPresets}
                                targetLabel="the whole house"
                                disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                                onClick={() => setOverrideTarget({
                                  channel: "temperature",
                                  scopeType: "house",
                                  scopeId: null,
                                  label: "Whole house",
                                })}
                              />
                            )}
                          />
                        );
                      }
                      return (
                        <article
                          className={`room-card relay-status-card relay-status-${status}${status === "unavailable" ? " has-device-issue" : ""}`}
                        >
                          <RelayDetails
                            name="Central heating"
                            actual={dashboard.controller.boiler_is_on}
                            requested={dashboard.controller.boiler_should_be_on}
                            technicalLabel="Heat requests"
                            technicalValue={`${dashboard.controller.heat_requests} of ${dashboard.controller.minimum_heat_requests}`}
                            overrideAction={<OverrideActionButton
                              active={override}
                              presets={dashboardPresets}
                              targetLabel="the whole house"
                              disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                              onClick={() => setOverrideTarget({
                                channel: "temperature",
                                scopeType: "house",
                                scopeId: null,
                                label: "Whole house",
                              })}
                            />}
                          />
                        </article>
                      );
                    })()}
                    {saved.hot_water_switch && (() => {
                      const status = relayStatus(
                        dashboard.controller.hot_water_is_on,
                        dashboard.controller.hot_water_should_be_on,
                      );
                      if (!detailedDashboard) {
                        return (
                          <CompactRelayCard
                            name="Hot water"
                            actual={dashboard.controller.hot_water_is_on}
                            status={status}
                            onOpen={() => setSelectedDashboardRelay("hot_water")}
                            overrideAction={(
                              <OverrideActionButton
                                active={dashboard.overrides.hot_water_override ?? null}
                                presets={dashboardPresets}
                                targetLabel="hot water"
                                disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                                onClick={() => setOverrideTarget({
                                  channel: "hot_water",
                                  scopeType: "hot_water",
                                  scopeId: null,
                                  label: "Hot water",
                                })}
                              />
                            )}
                          />
                        );
                      }
                      return (
                        <article
                          className={`room-card relay-status-card relay-status-${status}${status === "unavailable" ? " has-device-issue" : ""}`}
                        >
                          <RelayDetails
                            name="Hot water"
                            actual={dashboard.controller.hot_water_is_on}
                            requested={dashboard.controller.hot_water_should_be_on}
                            technicalLabel={dashboard.overrides.hot_water_override ? "Override" : "Next change"}
                            technicalValue={dashboard.overrides.hot_water_override
                                ? overrideSummary(
                                    dashboard.overrides.hot_water_override,
                                    dashboardPresets,
                                  )
                                : formatNextHotWaterChange(dashboard.controller)}
                            overrideAction={<OverrideActionButton
                              active={dashboard.overrides.hot_water_override ?? null}
                              presets={dashboardPresets}
                              targetLabel="hot water"
                              disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                              onClick={() => setOverrideTarget({
                                channel: "hot_water",
                                scopeType: "hot_water",
                                scopeId: null,
                                label: "Hot water",
                              })}
                            />}
                          />
                        </article>
                      );
                    })()}
                  </div>
                </section>
              )}
              <div className="room-groups">
              {dashboard.groups.map((group) => {
                const override = temperatureOverrideFor(dashboard, "group", group.name);
                return <section className="room-group" key={group.name}>
                  <header className="room-group-header">
                    <div>
                      <h2 className="md-typescale-headline-small">{group.name}</h2>
                      <span>{group.rooms.length} room{group.rooms.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="room-override-control">
                      <OverrideActionButton
                        active={override}
                        presets={dashboardPresets}
                        targetLabel={group.name}
                        disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                        onClick={() => setOverrideTarget({
                          channel: "temperature",
                          scopeType: "group",
                          scopeId: group.name,
                          label: group.name,
                        })}
                      />
                    </div>
                  </header>
                  <div className={`room-grid ${detailedDashboard ? "" : "compact-room-grid"}`}>
                    {group.rooms.map((room) =>
                      detailedDashboard ? (
                        <DetailedRoomCard
                          room={room}
                          key={room.device_id}
                          activeOverride={temperatureOverrideFor(
                            dashboard,
                            "room",
                            room.device_id,
                          )}
                          presets={dashboardPresets}
                          overrideDisabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                          onOverride={() => setOverrideTarget({
                            channel: "temperature",
                            scopeType: "room",
                            scopeId: room.device_id,
                            label: room.name,
                          })}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`compact-room-card room-status-${room.status}${roomHasDeviceIssue(room) ? " has-device-issue" : ""}`}
                          key={room.device_id}
                          aria-label={`Open details for ${room.name}, ${formatTemperature(room.current_temperature, room.unit)}, ${scheduleValueName(room.preset)}${room.override_scope_type === "room" ? ", room override active" : ""}${roomHasDeviceIssue(room) ? ", device issue" : ""}`}
                          onClick={() => setSelectedDashboardRoomId(room.device_id)}
                        >
                          <span className="compact-room-name">{room.name}</span>
                          <strong>{formatTemperature(room.current_temperature, room.unit)}</strong>
                          <CompactRoomIcons room={room} />
                        </button>
                      ),
                    )}
                  </div>
                </section>;
              })}
              </div>
              {selectedDashboardRoom && (
                <MdDialog
                  open
                  className={`room-detail-dialog room-status-${selectedDashboardRoom.status}${roomHasDeviceIssue(selectedDashboardRoom) ? " has-device-issue" : ""}`}
                  aria-label={`Room details for ${selectedDashboardRoom.name}`}
                  onCancel={() => setSelectedDashboardRoomId(null)}
                  onClosed={() => setSelectedDashboardRoomId(null)}
                >
                  <div
                    slot="content"
                    className="room-detail-dialog-content"
                    tabIndex={0}
                    autoFocus
                  >
                    <button
                      type="button"
                      className="room-detail-dialog-close"
                      aria-label="Close room details"
                      onClick={() => setSelectedDashboardRoomId(null)}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.71 2.88 18.3 9.17 12 2.88 5.7l1.41-1.41 6.3 6.3 6.3-6.3 1.41 1.42Z" />
                      </svg>
                    </button>
                    <RoomDetails
                      room={selectedDashboardRoom}
                      activeOverride={temperatureOverrideFor(
                        dashboard,
                        "room",
                        selectedDashboardRoom.device_id,
                      )}
                      presets={dashboardPresets}
                      overrideDisabled={
                        !dashboard.controller.enabled || Boolean(overrideSaving)
                      }
                      onOverride={() => {
                        setSelectedDashboardRoomId(null);
                        setOverrideTarget({
                          channel: "temperature",
                          scopeType: "room",
                          scopeId: selectedDashboardRoom.device_id,
                          label: selectedDashboardRoom.name,
                        });
                      }}
                    />
                  </div>
                </MdDialog>
              )}
              {selectedDashboardRelay && (
                <MdDialog
                  open
                  className={`room-detail-dialog${relayStatus(
                    selectedDashboardRelay === "heating"
                      ? dashboard.controller.boiler_is_on
                      : dashboard.controller.hot_water_is_on,
                    selectedDashboardRelay === "heating"
                      ? dashboard.controller.boiler_should_be_on
                      : dashboard.controller.hot_water_should_be_on,
                  ) === "unavailable" ? " has-device-issue" : ""}`}
                  aria-label={`${selectedDashboardRelay === "heating" ? "Central heating" : "Hot water"} details`}
                  onCancel={() => setSelectedDashboardRelay(null)}
                  onClosed={() => setSelectedDashboardRelay(null)}
                >
                  <div
                    slot="content"
                    className="room-detail-dialog-content"
                    tabIndex={0}
                    autoFocus
                  >
                    <button
                      type="button"
                      className="room-detail-dialog-close"
                      aria-label={`Close ${selectedDashboardRelay === "heating" ? "central heating" : "hot water"} details`}
                      onClick={() => setSelectedDashboardRelay(null)}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.71 2.88 18.3 9.17 12 2.88 5.7l1.41-1.41 6.3 6.3 6.3-6.3 1.41 1.42Z" />
                      </svg>
                    </button>
                    {selectedDashboardRelay === "heating" ? (() => {
                      const override = temperatureOverrideFor(dashboard, "house", null);
                      return (
                        <RelayDetails
                          name="Central heating"
                          actual={dashboard.controller.boiler_is_on}
                          requested={dashboard.controller.boiler_should_be_on}
                          technicalLabel="Heat requests"
                          technicalValue={`${dashboard.controller.heat_requests} of ${dashboard.controller.minimum_heat_requests}`}
                          overrideAction={<OverrideActionButton
                            active={override}
                            presets={dashboardPresets}
                            targetLabel="the whole house"
                            disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                            onClick={() => {
                              setSelectedDashboardRelay(null);
                              setOverrideTarget({
                                channel: "temperature",
                                scopeType: "house",
                                scopeId: null,
                                label: "Whole house",
                              });
                            }}
                          />}
                        />
                      );
                    })() : (() => {
                      return (
                        <RelayDetails
                          name="Hot water"
                          actual={dashboard.controller.hot_water_is_on}
                          requested={dashboard.controller.hot_water_should_be_on}
                          technicalLabel={dashboard.overrides.hot_water_override ? "Override" : "Next change"}
                          technicalValue={dashboard.overrides.hot_water_override
                            ? overrideSummary(
                                dashboard.overrides.hot_water_override,
                                dashboardPresets,
                              )
                            : formatNextHotWaterChange(dashboard.controller)}
                          overrideAction={<OverrideActionButton
                            active={dashboard.overrides.hot_water_override ?? null}
                            presets={dashboardPresets}
                            targetLabel="hot water"
                            disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                            onClick={() => {
                              setSelectedDashboardRelay(null);
                              setOverrideTarget({
                                channel: "hot_water",
                                scopeType: "hot_water",
                                scopeId: null,
                                label: "Hot water",
                              });
                            }}
                          />}
                        />
                      );
                    })()}
                  </div>
                </MdDialog>
              )}
              {overrideTarget && (
                <OverrideDialog
                  target={overrideTarget}
                  presets={dashboardPresets}
                  active={activeOverride}
                  disabled={!dashboard.controller.enabled}
                  saving={Boolean(overrideSaving)}
                  onClose={() => {
                    if (!overrideSaving) setOverrideTarget(null);
                  }}
                  onSubmit={(payload) => void saveOverride(payload)}
                  onClear={(payload) => void clearOverride(payload)}
                />
              )}
            </div>
          ) : (
            <div className="empty-state">
              <h2 className="md-typescale-headline-small">Room temperatures are unavailable</h2>
              <MdFilledButton type="button" onClick={() => void loadDashboard()}>Try again</MdFilledButton>
            </div>
          )}
        </section>
      ) : screen === "diagnostics" ? (
        <section className="diagnostics" aria-live="polite">
          {diagnosticsLoading && !diagnostics ? (
            <div className="loading">Loading system diagnostics…</div>
          ) : diagnostics ? (
            <div className="diagnostics-content">
              <section className={`diagnostic-overview diagnostic-${diagnostics.overall_status}`}>
                <div>
                  <span className="diagnostic-kicker">System status</span>
                  <strong>{diagnosticStatusLabel(diagnostics.overall_status)}</strong>
                </div>
                <span>
                  Updated {formatDateTime(diagnostics.updated_at)}
                </span>
              </section>

              {diagnostics.controller.fault_latched && (
                <section className="fault-recovery" role="alert">
                  <WarningIcon />
                  <div>
                    <strong>Heating is paused by a safety stop</strong>
                    <p>{diagnostics.controller.fault_reason}</p>
                    <small>
                      Check the affected device or relay first. Acknowledging clears the fault but
                      does not turn automatic control back on.
                    </small>
                  </div>
                  <MdOutlinedButton
                    type="button"
                    disabled={acknowledgingFault}
                    onClick={() => void acknowledgeFault()}
                  >
                    {acknowledgingFault ? "Acknowledging…" : "Acknowledge fault"}
                  </MdOutlinedButton>
                </section>
              )}

              <div className="diagnostic-summary-grid">
                <article className="diagnostic-summary-card">
                  <span>Heating mode</span>
                  <strong>{diagnostics.controller.mode}</strong>
                  <small>
                    {diagnostics.controller.active_boosts.length
                      ? `${diagnostics.controller.active_boosts.length} active boost${diagnostics.controller.active_boosts.length === 1 ? "" : "s"}`
                      : "No active boosts"}
                  </small>
                </article>
                <article className="diagnostic-summary-card">
                  <span>Control loop</span>
                  <strong>{diagnostics.controller.loop_status.replace("_", " ")}</strong>
                  <small>
                    Last successful cycle: {formatDateTime(diagnostics.controller.last_successful_cycle_at)}
                  </small>
                  <small>Expected every {diagnostics.controller.cycle_interval_seconds} seconds</small>
                  {diagnostics.controller.consecutive_failures > 0 && (
                    <small>
                      Consecutive failed cycles: {diagnostics.controller.consecutive_failures}
                    </small>
                  )}
                  {diagnostics.controller.loop_restarts > 0 && (
                    <small>Recovered loop crashes: {diagnostics.controller.loop_restarts}</small>
                  )}
                </article>
                <article className="diagnostic-summary-card">
                  <span>Central heating</span>
                  <strong>{relayState(diagnostics.plant.boiler.actual, diagnostics.plant.boiler.configured)}</strong>
                  <small>
                    Requested: {relayState(diagnostics.plant.boiler.requested, diagnostics.plant.boiler.configured)}
                  </small>
                  {diagnostics.plant.boiler.entity_id && <code>{diagnostics.plant.boiler.entity_id}</code>}
                </article>
                <article className="diagnostic-summary-card">
                  <span>Hot water</span>
                  <strong>{relayState(diagnostics.plant.hot_water.actual, diagnostics.plant.hot_water.configured)}</strong>
                  <small>
                    Requested: {relayState(diagnostics.plant.hot_water.requested, diagnostics.plant.hot_water.configured)}
                  </small>
                  {diagnostics.plant.hot_water.entity_id && <code>{diagnostics.plant.hot_water.entity_id}</code>}
                </article>
              </div>

              <section className="diagnostic-section">
                <header className="diagnostic-section-heading">
                  <h2 className="md-typescale-headline-small">Issues</h2>
                  <span>{diagnostics.issues.length}</span>
                </header>
                {diagnostics.issues.length ? (
                  <div className="diagnostic-issues">
                    {diagnostics.issues.map((issue, index) => (
                      <article className={`diagnostic-issue ${issue.severity}`} key={`${issue.title}-${index}`}>
                        <WarningIcon />
                        <div>
                          <strong>{issue.title}</strong>
                          <p>{issue.detail}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="diagnostic-empty">No current issues.</p>
                )}
              </section>

              <section className="diagnostic-section">
                <header className="diagnostic-section-heading">
                  <h2 className="md-typescale-headline-small">Current overrides</h2>
                  <span>
                    {diagnostics.controller.active_temperature_overrides.length +
                      (diagnostics.controller.active_hot_water_override ? 1 : 0)}
                  </span>
                </header>
                {diagnostics.controller.active_temperature_overrides.length > 0 ||
                diagnostics.controller.active_hot_water_override ? (
                  <div className="diagnostic-override-list">
                    {[
                      ...diagnostics.controller.active_temperature_overrides,
                      ...(diagnostics.controller.active_hot_water_override
                        ? [diagnostics.controller.active_hot_water_override]
                        : []),
                    ]
                      .sort((left, right) => right.sequence - left.sequence)
                      .map((override) => (
                        <article className="diagnostic-override" key={override.action_id}>
                          <div className="diagnostic-override-heading">
                            <span className="diagnostic-override-icon" aria-hidden="true">
                              <OverrideClockGraphic />
                            </span>
                            <div>
                              <strong>{overrideScopeLabel(override, diagnostics.rooms)}</strong>
                              <span>
                                {"on" in override ? "Hot water" : `${scheduleValueName(override.scope_type)} temperature`}
                              </span>
                            </div>
                          </div>
                          <strong>{overrideSummary(override, dashboardPresets)}</strong>
                          <dl>
                            <div>
                              <dt>Started</dt>
                              <dd>{formatDateTime(override.started_at)}</dd>
                            </div>
                            <div>
                              <dt>Initiated by</dt>
                              <dd>{overrideActorLabel(override)}</dd>
                            </div>
                          </dl>
                        </article>
                      ))}
                  </div>
                ) : (
                  <p className="diagnostic-empty">No temporary overrides are active.</p>
                )}
              </section>

              <section className="diagnostic-section">
                <header className="diagnostic-section-heading">
                  <h2 className="md-typescale-headline-small">Room decisions</h2>
                  <span>{diagnostics.rooms.length}</span>
                </header>
                <div className="diagnostic-room-list">
                  {diagnostics.rooms.map((room) => {
                    const appliedOverride = appliedOverrideForRoom(
                      room,
                      diagnostics.controller.active_temperature_overrides,
                    );
                    return <article className="diagnostic-room" key={room.device_id}>
                      <header>
                        <div>
                          <strong>{room.name}</strong>
                          <span>{room.room_group}</span>
                        </div>
                        <span className={`room-status-badge room-status-${room.status}`}>
                          {ROOM_STATUS_LABELS[room.status]}
                        </span>
                      </header>
                      <dl>
                        <div>
                          <dt>Measured</dt>
                          <dd>{formatTemperature(room.current_temperature, "°C")}</dd>
                        </div>
                        <div>
                          <dt>Effective target</dt>
                          <dd>{scheduleValueName(room.preset)} · {formatTemperature(room.scheduled_temperature, "°C")}</dd>
                        </div>
                        <div>
                          <dt>Demand</dt>
                          <dd>{room.demand ? "Requesting heat" : "Satisfied"}</dd>
                        </div>
                        <div>
                          <dt>TRV command</dt>
                          <dd>{formatTemperature(room.commanded_temperature, "°C")}</dd>
                        </div>
                      </dl>

                      <div className="diagnostic-reasoning" aria-label="Control decision explanation">
                        <div>
                          <strong>Target</strong>
                          <span>
                            {room.temperature_reason ??
                              `${scheduleValueName(room.control_source)} sets the effective target to ${formatTemperature(room.scheduled_temperature, "°C")}.`}
                          </span>
                        </div>
                        <div>
                          <strong>Demand</strong>
                          <span>
                            {room.demand_reason ??
                              (room.demand
                                ? "The room is currently requesting heat."
                                : "The room is currently satisfied.")}
                          </span>
                        </div>
                        <div>
                          <strong>Command</strong>
                          <span>
                            {room.command_reason ??
                              `The controller selected a ${formatTemperature(room.commanded_temperature, "°C")} TRV command.`}
                          </span>
                        </div>
                      </div>

                      {appliedOverride && (
                        <div className="diagnostic-applied-override">
                          <span className="diagnostic-override-icon" aria-hidden="true">
                            <OverrideClockGraphic />
                          </span>
                          <div>
                            <strong>
                              {scheduleValueName(appliedOverride.scope_type)} override applied
                            </strong>
                            <span>
                              {overrideSummary(appliedOverride, dashboardPresets)} · started {formatDateTime(appliedOverride.started_at)} · {overrideActorLabel(appliedOverride)}
                            </span>
                          </div>
                        </div>
                      )}

                      {room.warning && (
                        <div className="diagnostic-room-warning">
                          <WarningIcon />
                          <span>{room.warning}</span>
                        </div>
                      )}

                      <dl className="diagnostic-room-facts">
                        <div>
                          <dt>Room schedule</dt>
                          <dd>
                            {scheduleValueName(room.schedule_preset ?? room.preset)} · {formatTemperature(
                              room.schedule_temperature ?? room.scheduled_temperature,
                              "°C",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Control source</dt>
                          <dd>{scheduleValueName(room.control_source)}</dd>
                        </div>
                        <div>
                          <dt>Next schedule</dt>
                          <dd>{formatNextScheduleValue(room)}</dd>
                        </div>
                        <div>
                          <dt>Temperature source</dt>
                          <dd>{room.temperature_source}</dd>
                        </div>
                        <div>
                          <dt>Temperature entity</dt>
                          <dd><code>{room.temperature_entity}</code></dd>
                        </div>
                        <div>
                          <dt>External sensor</dt>
                          <dd>{formatTemperature(room.external_temperature, "°C")}</dd>
                        </div>
                        <div>
                          <dt>TRV sensor</dt>
                          <dd>{formatTemperature(room.trv_temperature, "°C")}</dd>
                        </div>
                        <div>
                          <dt>Sensor health</dt>
                          <dd>
                            {room.external_temperature_freshness === "disabled"
                              ? "Freshness check disabled"
                              : room.external_temperature_health_entity
                                ? `${formatAge(room.external_temperature_age_seconds)} via ${room.external_temperature_health_entity}`
                                : "Not configured"}
                          </dd>
                        </div>
                        <div>
                          <dt>TRV last seen</dt>
                          <dd>{room.trv_last_seen_at ? formatDateTime(room.trv_last_seen_at) : "Unavailable"}</dd>
                        </div>
                        <div>
                          <dt>Reported target</dt>
                          <dd>{formatTemperature(room.reported_target_temperature, "°C")}</dd>
                        </div>
                        <div>
                          <dt>TRV mode / action</dt>
                          <dd>{room.hvac_mode ?? "unknown"} / {room.hvac_action ?? "unknown"}</dd>
                        </div>
                        <div>
                          <dt>Climate entity</dt>
                          <dd><code>{room.climate_entity}</code></dd>
                        </div>
                      </dl>
                    </article>;
                  })}
                </div>
              </section>

              <section className="diagnostic-section">
                <header className="diagnostic-section-heading">
                  <h2 className="md-typescale-headline-small">Recent activity</h2>
                  <span>{diagnostics.events.length}</span>
                </header>
                {diagnostics.events.length ? (
                  <ol className="diagnostic-events">
                    {diagnostics.events.map((event, index) => (
                      <li className={`diagnostic-event ${event.level}`} key={`${event.occurred_at}-${index}`}>
                        <time dateTime={event.occurred_at}>{formatDateTime(event.occurred_at)}</time>
                        <span>{event.message}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="diagnostic-empty">No control activity has been recorded yet.</p>
                )}
              </section>
            </div>
          ) : (
            <div className="empty-state">
              <h2 className="md-typescale-headline-small">Diagnostics are unavailable</h2>
              <MdFilledButton type="button" onClick={() => void loadDiagnostics()}>Try again</MdFilledButton>
            </div>
          )}
        </section>
      ) : !discovery ? (
        <section className="empty-state">
          <h2 className="md-typescale-headline-small">Home Assistant is unavailable</h2>
          <MdFilledButton type="button" onClick={() => void load()}>Try again</MdFilledButton>
        </section>
      ) : screen === "devices" ? (
        <form onSubmit={save}>
          <section className="section-heading radiator-section-heading">
            <div>
              <h2 className="md-typescale-headline-small">Radiator valves</h2>
              <p>Select each room you want to control.</p>
            </div>
            <div className="radiator-heading-actions">
              <span className="selection-count">
                {selectedCount} of {discovery.trvs.length} selected
              </span>
              <MdTextButton type="button" onClick={() => void load(true)}>
                Rescan devices
              </MdTextButton>
            </div>
          </section>

          {discovery.trvs.length === 0 ? (
            <div className="message error">No SONOFF TRVZB devices with climate entities were found.</div>
          ) : (
            <div className="trv-grid">
              {discovery.trvs.map((trv) => {
                const selection = selections[trv.device_id];
                if (!selection) return null;
                const configured = selectionIsConfigured(selection, discovery);
                const collapsed = configured && !expandedDevices.has(trv.device_id);
                const externalSensor = discovery.temperature_sensors.find(
                  (sensor) => sensor.entity_id === selection.external_temperature_sensor,
                );
                if (collapsed) {
                  return (
                    <article className="trv-card selected configured" key={trv.device_id}>
                      <div className="configured-trv-summary">
                        <span className="configured-check" aria-label="Configured correctly">
                          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
                          </svg>
                        </span>
                        <div className="configured-device-names">
                          <strong>{trv.name}</strong>
                          {externalSensor && (
                            <small>{externalSensor.device_name ?? externalSensor.name}</small>
                          )}
                        </div>
                        <MdTextButton
                          type="button"
                          aria-label={`Edit ${trv.name}`}
                          onClick={() =>
                            setExpandedDevices((current) => {
                              const next = new Set(current);
                              next.add(trv.device_id);
                              return next;
                            })
                          }
                        >
                          Edit
                        </MdTextButton>
                      </div>
                    </article>
                  );
                }
                return (
                  <article className={`trv-card ${selection.enabled ? "selected" : ""}`} key={trv.device_id}>
                    <div className="trv-expanded-header">
                      <label className="trv-title">
                        <MdCheckbox
                          checked={selection.enabled}
                          onChange={(event) =>
                            updateSelection(trv.device_id, { enabled: eventChecked(event) })
                          }
                        />
                        <span>
                          <strong>{trv.name}</strong>
                          <small>
                            {[trv.area_name, trv.software_version && `Firmware ${trv.software_version}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                      </label>
                      {configured && (
                        <MdTextButton
                          type="button"
                          onClick={() =>
                            setExpandedDevices((current) => {
                              const next = new Set(current);
                              next.delete(trv.device_id);
                              return next;
                            })
                          }
                        >
                          Done
                        </MdTextButton>
                      )}
                    </div>

                    {selection.enabled && (
                      <div className="trv-fields control-fields">
                        <ControlSettingRow
                          title="Room group"
                          description="Rooms in the same group share a schedule and group-level overrides."
                        >
                          <MdOutlinedTextField
                            maxLength={80}
                            label="Group"
                            value={selection.room_group}
                            onInput={(event) =>
                              updateSelection(trv.device_id, { room_group: eventValue(event) })
                            }
                          />
                        </ControlSettingRow>
                        <ControlSettingRow
                          title="External temperature sensor"
                          description="Optional; used for room demand while the valve continues using its own sensor."
                        >
                          <MdOutlinedSelect
                            label="Sensor"
                            value={selection.external_temperature_sensor}
                            onChange={(event) => {
                              const entityId = eventValue(event);
                              const healthEntity = discovery.temperature_sensors.find(
                                (sensor) => sensor.entity_id === entityId,
                              )?.suggested_last_seen_entity;
                              updateSelection(trv.device_id, {
                                external_temperature_sensor: entityId,
                                external_temperature_last_seen: healthEntity ?? "",
                                external_temperature_freshness: healthEntity
                                  ? "last_seen"
                                  : "state_updates",
                              });
                            }}
                          >
                            <MdSelectOption value="">Use the valve’s own temperature</MdSelectOption>
                            {discovery.temperature_sensors.map((sensor) => (
                              <MdSelectOption
                                value={sensor.entity_id}
                                displayText={sensorOptionHeadline(sensor)}
                                key={sensor.entity_id}
                              >
                                <span slot="headline">{sensorOptionHeadline(sensor)}</span>
                              </MdSelectOption>
                            ))}
                          </MdOutlinedSelect>
                        </ControlSettingRow>
                        {selection.external_temperature_sensor && (
                          <>
                            <ControlSettingRow
                              title="External sensor health"
                              description="How the add-on determines whether the external reading is still trustworthy."
                            >
                              <MdOutlinedSelect
                                label="Health source"
                                value={
                                  selection.external_temperature_freshness === "last_seen"
                                    ? selection.external_temperature_last_seen
                                    : `__${selection.external_temperature_freshness}__`
                                }
                                onChange={(event) => {
                                  const value = eventValue(event);
                                  updateSelection(trv.device_id, {
                                    external_temperature_freshness:
                                      value === "__state_updates__"
                                        ? "state_updates"
                                        : value === "__disabled__"
                                          ? "disabled"
                                          : "last_seen",
                                    external_temperature_last_seen: value.startsWith("__")
                                      ? ""
                                      : value,
                                  });
                                }}
                              >
                                {discovery.health_sensors.map((sensor) => (
                                  <MdSelectOption
                                    value={sensor.entity_id}
                                    displayText={healthOptionHeadline(sensor)}
                                    key={sensor.entity_id}
                                  >
                                    <span slot="headline">{healthOptionHeadline(sensor)}</span>
                                  </MdSelectOption>
                                ))}
                                <MdSelectOption value="__state_updates__">
                                  Use temperature updates
                                </MdSelectOption>
                                <MdSelectOption value="__disabled__">
                                  Do not check freshness
                                </MdSelectOption>
                              </MdOutlinedSelect>
                            </ControlSettingRow>
                            {selection.external_temperature_freshness !== "disabled" && (
                              <ControlSettingRow
                                title="External sensor stale time"
                                description={`Fall back to the valve sensor after this long; blank uses ${Math.round(
                                  Number(control.external_sensor_stale_minutes),
                                )} minutes.`}
                              >
                                <MdOutlinedTextField
                                  type="number"
                                  min="5"
                                  max="1440"
                                  step="5"
                                  label="Minutes (optional)"
                                  value={selection.external_sensor_stale_minutes}
                                  onInput={(event) =>
                                    updateSelection(trv.device_id, {
                                      external_sensor_stale_minutes: eventValue(event),
                                    })
                                  }
                                />
                              </ControlSettingRow>
                            )}
                          </>
                        )}
                        <details>
                          <summary>
                            Technical details · {Object.values(trv.entities).filter(Boolean).length} entities
                          </summary>
                          <ControlSettingRow
                            title="TRV health"
                            description="How the add-on determines whether the valve is available for control."
                          >
                            <MdOutlinedSelect
                              label="Health source"
                              value={
                                selection.trv_freshness === "last_seen"
                                  ? selection.trv_last_seen
                                  : `__${selection.trv_freshness}__`
                              }
                              onChange={(event) => {
                                const value = eventValue(event);
                                updateSelection(trv.device_id, {
                                  trv_freshness:
                                    value === "__state_updates__"
                                      ? "state_updates"
                                      : value === "__disabled__"
                                        ? "disabled"
                                        : "last_seen",
                                  trv_last_seen: value.startsWith("__") ? "" : value,
                                });
                              }}
                            >
                              {discovery.health_sensors.map((sensor) => (
                                <MdSelectOption
                                  value={sensor.entity_id}
                                  displayText={healthOptionHeadline(sensor)}
                                  key={sensor.entity_id}
                                >
                                  <span slot="headline">{healthOptionHeadline(sensor)}</span>
                                </MdSelectOption>
                              ))}
                              <MdSelectOption value="__state_updates__">
                                Use TRV state updates
                              </MdSelectOption>
                              <MdSelectOption value="__disabled__">
                                Do not check freshness
                              </MdSelectOption>
                            </MdOutlinedSelect>
                          </ControlSettingRow>
                          <dl className="entity-map">
                            {Object.entries(trv.entities).map(([role, entityId]) => (
                              <div key={role} className={!entityId ? "missing" : ""}>
                                <dt>{friendlyRole(role)}</dt>
                                <dd>{entityId || "Not exposed"}</dd>
                              </div>
                            ))}
                          </dl>
                          {trv.missing_recommended.length > 0 && (
                            <p className="mapping-warning">
                              Missing recommended entities: {trv.missing_recommended.map(friendlyRole).join(", ")}
                            </p>
                          )}
                        </details>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <footer className="save-bar">
            <div className="save-actions">
              {setupComplete && (
                <MdTextButton
                  type="button"
                  disabled={saving}
                  onClick={() => revertSettings("devices")}
                >
                  Revert
                </MdTextButton>
              )}
              <MdFilledButton type="submit" disabled={saving || selectedCount === 0}>
                {saving ? "Verifying…" : "Save configuration"}
              </MdFilledButton>
            </div>
          </footer>
          {notice && <div className="message success bottom-notice" role="status">{notice}</div>}
          {visibleError && (
            <div className="message error bottom-message" role="alert">
              <strong>Couldn’t continue.</strong> {visibleError}
            </div>
          )}
        </form>
      ) : screen === "boiler" ? (
        <form onSubmit={saveBoiler}>
          <section className="section-heading">
            <div>
              <h2 className="md-typescale-headline-small">Boiler</h2>
              <p>
                Choose which heating and hot-water relays Heat Steward should control. Both are
                optional.
              </p>
            </div>
          </section>

          <section className="settings-list boiler-card">
            <section className="boiler-settings-group">
              <header className="control-settings-heading">
                <h3 className="md-typescale-title-medium">Central heating</h3>
                <p>
                  Configure the boiler relay and how much room demand is needed to turn it on.
                </p>
              </header>
              <div className="control-fields">
                <ControlSettingRow
                  title="Heating switch"
                  description="The relay that turns central heating on; leave unset to control TRVs only."
                >
                  <MdOutlinedSelect
                    label="Switch (optional)"
                    value={boilerSwitch}
                    onChange={(event) => {
                      setBoilerSwitch(eventValue(event));
                      setNotice("");
                    }}
                  >
                    <MdSelectOption value="">Do not control heating</MdSelectOption>
                    {discovery.switches.map((item) => (
                      <MdSelectOption value={item.entity_id} key={item.entity_id}>
                        {optionLabel(item)}
                      </MdSelectOption>
                    ))}
                  </MdOutlinedSelect>
                </ControlSettingRow>
                <ControlSettingRow
                  title="Radiators required to start heating"
                  description="Turn on the heating switch once at least this many available rooms request heat."
                >
                  <MdOutlinedTextField
                    label="Radiators"
                    type="number"
                    min="1"
                    max={String(maximumHeatRequests)}
                    step="1"
                    value={minimumHeatRequests}
                    onInput={(event) => {
                      setMinimumHeatRequests(eventValue(event));
                      setNotice("");
                    }}
                  />
                </ControlSettingRow>
              </div>
            </section>

            <section className="control-settings-group boiler-settings-group">
              <header className="control-settings-heading">
                <h3 className="md-typescale-title-medium">Hot water</h3>
                <p>Optionally choose the relay controlled by the hot-water schedule.</p>
              </header>
              <div className="control-fields">
                <ControlSettingRow
                  title="Hot-water switch"
                  description="Leave unset when Heat Steward should not control hot water."
                >
                  <MdOutlinedSelect
                    label="Switch (optional)"
                    value={hotWaterSwitch}
                    onChange={(event) => {
                      setHotWaterSwitch(eventValue(event));
                      setNotice("");
                    }}
                  >
                    <MdSelectOption value="">Do not control hot water</MdSelectOption>
                    {discovery.switches.map((item) => (
                      <MdSelectOption value={item.entity_id} key={item.entity_id}>
                        {optionLabel(item)}
                      </MdSelectOption>
                    ))}
                  </MdOutlinedSelect>
                </ControlSettingRow>
              </div>
            </section>
          </section>

          <footer className="save-bar">
            <div className="save-actions">
              {setupComplete ? (
                <MdTextButton
                  type="button"
                  disabled={saving}
                  onClick={() => revertSettings("boiler")}
                >
                  Revert
                </MdTextButton>
              ) : (
                <MdTextButton type="button" onClick={() => showScreen("devices")}>Back</MdTextButton>
              )}
              {!saved?.setup.boiler && (
                <MdTextButton
                  type="button"
                  disabled={saving}
                  onClick={() => void persistBoilerSettings(true)}
                >
                  Continue without relays
                </MdTextButton>
              )}
              <MdFilledButton type="submit" disabled={saving || !minimumHeatRequestsValid}>
                {saving ? "Saving…" : "Save boiler settings"}
              </MdFilledButton>
            </div>
          </footer>
          {notice && <div className="message success bottom-notice" role="status">{notice}</div>}
          {visibleError && (
            <div className="message error bottom-message" role="alert">
              <strong>Couldn’t continue.</strong> {visibleError}
            </div>
          )}
        </form>
      ) : screen === "control" ? (
        <form onSubmit={saveControl}>
          <section className="section-heading">
            <div>
              <h2 className="md-typescale-headline-small">Heating control</h2>
              <p>The add-on calculates room demand while each valve keeps using its own sensor.</p>
            </div>
          </section>

          <section className="settings-list">
            {saved?.safety?.fault_latched && (
              <div className="control-fault">
                <WarningIcon />
                <span>
                  <strong>Heating is paused by a safety stop</strong>
                  <small>{saved.safety.fault_reason}</small>
                </span>
                <MdTextButton type="button" onClick={() => { showScreen("diagnostics"); void loadDiagnostics(); }}>
                  Open diagnostics
                </MdTextButton>
              </div>
            )}
            <div className="control-fields">
              <ControlSettingRow
                title="Automatic control"
                description="Disabling turns controlled relays off; decisions remain visible without writes."
              >
                <MdSwitch
                  aria-label="Automatic control"
                  selected={control.enabled}
                  disabled={saved?.safety?.fault_latched && !control.enabled}
                  onChange={(event) => toggleAutomaticControl(eventSelected(event))}
                />
              </ControlSettingRow>
            </div>

            {(preflightLoading || preflight) && (
              <section className={`preflight ${preflight?.ok ? "passed" : "blocked"}`}>
                <header>
                  <strong>
                    {preflightLoading
                      ? "Checking the system before activation…"
                      : preflight?.ok
                        ? "Ready to enable automatic control"
                        : "Automatic control cannot be enabled yet"}
                  </strong>
                  {!preflightLoading && preflight?.ok && (
                    <span>Press Enable automatic control to confirm activation.</span>
                  )}
                </header>
                {preflight && (
                  <ul>
                    {preflight.checks.map((check) => (
                      <li
                        className={
                          check.passed ? "passed" : check.severity === "warning" ? "warning" : "failed"
                        }
                        key={check.key}
                      >
                        <span aria-hidden="true">
                          {check.passed ? "✓" : check.severity === "warning" ? "!" : "×"}
                        </span>
                        <div><strong>{check.label}</strong><small>{check.detail}</small></div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section className="control-settings-group">
              <header className="control-settings-heading">
                <h3 className="md-typescale-title-large">Add-on control</h3>
                <p>How Heat Steward decides when rooms and the boiler need heat.</p>
              </header>
              <div className="control-fields">
                <ControlSettingRow
                  title="Away mode preset"
                  description="The preset applied to every room in Away mode unless an override is active."
                >
                  <MdOutlinedSelect
                    label="Preset"
                    value={control.away_preset}
                    onChange={(event) =>
                      updateControl({ away_preset: eventValue(event) as PresetKey })
                    }
                  >
                    {PRESET_DEFINITIONS.map((preset) => (
                      <MdSelectOption value={preset.key} key={preset.key}>
                        {preset.name}
                      </MdSelectOption>
                    ))}
                  </MdOutlinedSelect>
                </ControlSettingRow>
                {ADDON_CONTROL_FIELDS.map((field) => (
                  <ControlSettingRow
                    title={field.title}
                    description={field.description}
                    key={field.key}
                  >
                    <MdOutlinedTextField
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      label={field.inputLabel}
                      value={control[field.key]}
                      onInput={(event) => updateControl({ [field.key]: eventValue(event) })}
                    />
                  </ControlSettingRow>
                ))}
              </div>
            </section>

            <section className="control-settings-group trv-settings-group">
              <header className="control-settings-heading">
                <h3 className="md-typescale-title-large">TRV settings</h3>
                <p>Values the add-on enforces on every selected valve during each control cycle.</p>
              </header>
              <div className="control-fields">
                <ControlSettingRow
                  title="Operating mode"
                  description="Keep every valve in Heat mode so the add-on can set its target."
                >
                  <MdOutlinedSelect label="Mode" value="heat" disabled>
                    <MdSelectOption value="heat" displayText="Heat">Heat</MdSelectOption>
                  </MdOutlinedSelect>
                </ControlSettingRow>
                <ControlSettingRow
                  title="Temperature source"
                  description="Keep each valve on its internal sensor; external readings are not written to it."
                >
                  <MdOutlinedSelect label="Source" value="internal" disabled>
                    <MdSelectOption value="internal" displayText="Internal sensor">
                      Internal sensor
                    </MdSelectOption>
                  </MdOutlinedSelect>
                </ControlSettingRow>
                <ControlSettingRow
                  title="Frost protection temperature"
                  description="The minimum temperature the valve itself protects when frost protection applies."
                >
                  <MdOutlinedTextField
                    type="number"
                    min="4"
                    max="35"
                    step="0.5"
                    label="Temperature °C"
                    value={control.frost_protection_temperature}
                    onInput={(event) =>
                      updateControl({ frost_protection_temperature: eventValue(event) })
                    }
                  />
                </ControlSettingRow>
                <ControlSettingRow
                  title="Smart temperature control"
                  description="Use the SONOFF valve's own smart temperature-control feature."
                >
                  <MdSwitch
                    aria-label="Smart temperature control"
                    selected={control.smart_temperature_control}
                    onChange={(event) =>
                      updateControl({ smart_temperature_control: eventSelected(event) })
                    }
                  />
                </ControlSettingRow>
                <ControlSettingRow
                  title="Open-window detection"
                  description="Let the valve pause itself when it detects a rapid temperature drop."
                >
                  <MdSwitch
                    aria-label="Open-window detection"
                    selected={control.open_window_detection}
                    onChange={(event) =>
                      updateControl({ open_window_detection: eventSelected(event) })
                    }
                  />
                </ControlSettingRow>
                <ControlSettingRow
                  title="Child lock"
                  description="Lock physical controls on the valve; leave off for direct local adjustment."
                >
                  <MdSwitch
                    aria-label="Child lock"
                    selected={control.child_lock}
                    onChange={(event) => updateControl({ child_lock: eventSelected(event) })}
                  />
                </ControlSettingRow>
              </div>
            </section>
          </section>

          <footer className="save-bar">
            <div className="save-actions">
              {setupComplete ? (
                <MdTextButton
                  type="button"
                  disabled={saving || preflightLoading}
                  onClick={() => revertSettings("control")}
                >
                  Revert
                </MdTextButton>
              ) : (
                <MdTextButton type="button" onClick={() => showScreen("boiler")}>Back</MdTextButton>
              )}
              <MdFilledButton type="submit" disabled={saving || preflightLoading}>
                {saving
                  ? "Saving…"
                  : control.enabled && !saved?.control.enabled
                    ? preflight?.ok
                      ? "Enable automatic control"
                      : "Run safety checks"
                    : "Save control settings"}
              </MdFilledButton>
            </div>
          </footer>
          {notice && <div className="message success bottom-notice" role="status">{notice}</div>}
          {visibleError && (
            <div className="message error bottom-message" role="alert">
              <strong>Couldn’t continue.</strong> {visibleError}
            </div>
          )}
        </form>
      ) : screen === "presets" ? (
        <form onSubmit={savePresets}>
          <section className="section-heading">
            <div>
              <h2 className="md-typescale-headline-small">Temperature presets</h2>
              <p>These global targets will be available for every room.</p>
            </div>
          </section>

          <section className="settings-list preset-settings-card">
            <div className="control-fields">
              {PRESET_DEFINITIONS.map((preset) => (
                <ControlSettingRow
                  title={preset.name}
                  description={preset.description}
                  key={preset.key}
                >
                  <MdOutlinedTextField
                    label="Temperature °C"
                    type="number"
                    min="5"
                    max="30"
                    step="0.5"
                    value={presets[preset.key]}
                    onInput={(event) => updatePreset(preset.key, eventValue(event))}
                  />
                </ControlSettingRow>
              ))}
            </div>
          </section>

          <footer className="save-bar">
            <div className="save-actions">
              {setupComplete ? (
                <MdTextButton
                  type="button"
                  disabled={saving}
                  onClick={() => revertSettings("presets")}
                >
                  Revert
                </MdTextButton>
              ) : (
                <MdTextButton type="button" onClick={() => showScreen("control")}>Back</MdTextButton>
              )}
              <MdFilledButton type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save presets"}
              </MdFilledButton>
            </div>
          </footer>
          {notice && <div className="message success bottom-notice" role="status">{notice}</div>}
          {visibleError && (
            <div className="message error bottom-message" role="alert">
              <strong>Couldn’t continue.</strong> {visibleError}
            </div>
          )}
        </form>
      ) : screen === "schedules" ? (
        <form onSubmit={saveSchedules}>
          <section className="section-heading schedule-heading">
            <div>
              <h2 className="md-typescale-headline-small">Weekly schedules</h2>
              <p>Set timed overrides for room groups and hot water.</p>
            </div>
            <MdOutlinedSelect
              label="Schedule"
              value={selectedRoomGroup}
              onChange={(event) => setSelectedRoomGroup(eventValue(event))}
            >
              {schedules.map((schedule) => (
                <MdSelectOption value={schedule.room_group} key={schedule.room_group}>
                  {schedule.room_group}
                </MdSelectOption>
              ))}
              {saved?.hot_water_switch && (
                <MdSelectOption value={HOT_WATER_SCHEDULE_KEY}>Hot water</MdSelectOption>
              )}
            </MdOutlinedSelect>
          </section>

          {(selectedSchedule || editingHotWater) && (
            <>
              <section className="schedule-overview" aria-label={`${activeScheduleName} weekly schedule`}>
                <div className="schedule-overview-header">
                  <div>
                    <h3 className="md-typescale-title-large">{activeScheduleName}</h3>
                    <p>At a glance</p>
                  </div>
                  <MdOutlinedSelect
                    label={editingHotWater ? "Default state" : "Default preset"}
                    value={activeDefaultValue}
                    onChange={(event) => updateDefaultScheduleValue(eventValue(event))}
                  >
                    {activeDefinitions.map((definition) => (
                      <MdSelectOption
                        value={definition.key}
                        displayText={definition.name}
                        key={definition.key}
                      >
                        {definition.name}
                      </MdSelectOption>
                    ))}
                  </MdOutlinedSelect>
                </div>
                <div className="timeline-axis" aria-hidden="true">
                  <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
                </div>
                <div className="weekly-timeline">
                  {WEEKDAYS.map((day) => (
                    <div className="timeline-row" key={day.key}>
                      <strong>{day.short}</strong>
                      <div
                        className={`timeline-track preset-${activeDefaultValue}`}
                        aria-label={`${day.name}, default ${scheduleValueName(activeDefaultValue)}`}
                      >
                        {activePeriods
                          .filter((period) => period.days.includes(day.key))
                          .map((period, index) => {
                            const start = timeMinutes(period.start);
                            const end = timeMinutes(period.end);
                            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
                            const title = `${scheduleValueName(period.value)} · ${period.start}–${period.end}`;
                            return (
                              <span
                                className={`timeline-period preset-${period.value}`}
                                style={{ left: `${(start / 1440) * 100}%`, width: `${((end - start) / 1440) * 100}%` }}
                                title={title}
                                aria-label={title}
                                key={`${period.start}-${period.end}-${index}`}
                              >
                                {end - start >= 180 ? scheduleValueName(period.value) : ""}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="schedule-legend" aria-label="Schedule colours">
                  {activeDefinitions.map((definition) => (
                    <span key={definition.key}>
                      <i className={`preset-${definition.key}`} />{definition.name}
                    </span>
                  ))}
                </div>
              </section>

              <section className="periods-section">
                <div className="section-heading">
                  <div>
                    <h2 className="md-typescale-headline-small">Timed periods</h2>
                  </div>
                  <MdFilledButton type="button" onClick={addPeriod}>Add period</MdFilledButton>
                </div>

                {activePeriods.length === 0 ? (
                  <div className="empty-periods">
                    <strong>No timed periods yet</strong>
                    <span>{scheduleValueName(activeDefaultValue)} will be used all week.</span>
                  </div>
                ) : (
                  <div className="period-list">
                    {activePeriods.map((period, index) => (
                      <article className="period-card" key={index}>
                        <div className="period-title">
                          <h3 className="md-typescale-title-medium">Period {index + 1}</h3>
                          <MdTextButton type="button" onClick={() => removePeriod(index)}>Remove</MdTextButton>
                        </div>
                        <div className="day-picker" aria-label={`Days for period ${index + 1}`}>
                          {WEEKDAYS.map((day) => (
                            <button
                              type="button"
                              className={period.days.includes(day.key) ? "selected" : ""}
                              aria-pressed={period.days.includes(day.key)}
                              onClick={() => togglePeriodDay(index, day.key)}
                              key={day.key}
                            >
                              {day.short}
                            </button>
                          ))}
                        </div>
                        <div className="period-fields">
                          <MdOutlinedTextField
                            required
                            type="time"
                            label="Start"
                            value={period.start}
                            onInput={(event) => updatePeriod(index, { start: eventValue(event) })}
                          />
                          <MdOutlinedTextField
                            required
                            type="time"
                            label="End"
                            value={period.end}
                            onInput={(event) => updatePeriod(index, { end: eventValue(event) })}
                          />
                          <MdOutlinedSelect
                            label={editingHotWater ? "State" : "Preset"}
                            value={period.value}
                            onChange={(event) =>
                              updatePeriod(index, {
                                value: eventValue(event) as PresetKey | HotWaterState,
                              })
                            }
                          >
                            {activeDefinitions.map((definition) => (
                              <MdSelectOption
                                value={definition.key}
                                displayText={definition.name}
                                key={definition.key}
                              >
                                {definition.name}
                              </MdSelectOption>
                            ))}
                          </MdOutlinedSelect>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          <footer className="save-bar">
            <div className="save-actions">
              {setupComplete ? (
                <MdTextButton
                  type="button"
                  disabled={saving}
                  onClick={() => revertSettings("schedules")}
                >
                  Revert
                </MdTextButton>
              ) : (
                <MdTextButton type="button" onClick={() => showScreen("boiler")}>Back</MdTextButton>
              )}
              <MdFilledButton type="submit" disabled={saving || schedules.length === 0}>
                {saving ? "Saving…" : "Save schedules"}
              </MdFilledButton>
            </div>
          </footer>
          {notice && <div className="message success bottom-notice" role="status">{notice}</div>}
          {visibleError && (
            <div className="message error bottom-message" role="alert">
              <strong>Couldn’t continue.</strong> {visibleError}
            </div>
          )}
        </form>
      ) : (
        <form onSubmit={saveNotifications}>
          <section className="section-heading">
            <div>
              <h2 className="md-typescale-headline-small">Notifications</h2>
              <p>Send important heating alerts directly to Discord.</p>
            </div>
          </section>

          <section className="settings-list notification-card">
            <div className="control-fields notification-settings">
              <ControlSettingRow
                title="Discord notifications"
                description="Send add-on alerts to Discord; Home Assistant safety notifications remain active."
              >
                <MdSwitch
                  aria-label="Discord notifications"
                  selected={notifications.enabled}
                  onChange={(event) => {
                    const enabled = eventSelected(event);
                    setNotifications((current) => ({
                      ...current,
                      enabled,
                    }));
                    setNotice("");
                  }}
                />
              </ControlSettingRow>
              <ControlSettingRow
                title="Discord webhook"
                description="The channel destination; its secret URL is omitted from the UI and diagnostics."
              >
                <MdOutlinedTextField
                  label="Webhook URL"
                  type="password"
                  value={discordWebhook}
                  onFocus={() => {
                    if (discordWebhook === CONFIGURED_WEBHOOK_VALUE) setDiscordWebhook("");
                  }}
                  onBlur={() => {
                    if (!discordWebhook && saved?.notifications?.discord_webhook_configured) {
                      setDiscordWebhook(CONFIGURED_WEBHOOK_VALUE);
                    }
                  }}
                  onInput={(event) => {
                    setDiscordWebhook(eventValue(event));
                    setNotice("");
                  }}
                />
              </ControlSettingRow>
              <ControlSettingRow
                title="Notification level"
                description="Choose whether Discord receives critical faults only or warnings as well."
              >
                <MdOutlinedSelect
                  label="Level"
                  value={notifications.level}
                  onChange={(event) => {
                    const level = eventValue(event) as NotificationValues["level"];
                    setNotifications((current) => ({
                      ...current,
                      level,
                    }));
                    setNotice("");
                  }}
                >
                  <MdSelectOption value="critical">Critical only</MdSelectOption>
                  <MdSelectOption value="warning">Critical and warnings</MdSelectOption>
                </MdOutlinedSelect>
              </ControlSettingRow>
              {notifications.level === "warning" && (
                <ControlSettingRow
                  title="Warning delay"
                  description="Wait before alerting so brief sensor or device dropouts do not send messages."
                >
                  <MdOutlinedTextField
                    required
                    label="Minutes"
                    type="number"
                    min="1"
                    max="1440"
                    step="1"
                    value={notifications.warning_delay_minutes}
                    onInput={(event) => {
                      const warningDelayMinutes = eventValue(event);
                      setNotifications((current) => ({
                        ...current,
                        warning_delay_minutes: warningDelayMinutes,
                      }));
                      setNotice("");
                    }}
                  />
                </ControlSettingRow>
              )}
              <ControlSettingRow
                title="Recovery notifications"
                description="Send one message when a previously reported problem returns to normal."
              >
                <MdSwitch
                  aria-label="Recovery notifications"
                  selected={notifications.send_recovery}
                  onChange={(event) => {
                    const sendRecovery = eventSelected(event);
                    setNotifications((current) => ({
                      ...current,
                      send_recovery: sendRecovery,
                    }));
                    setNotice("");
                  }}
                />
              </ControlSettingRow>
            </div>
          </section>

          <footer className="save-bar">
            <div className="save-actions notification-actions">
              {setupComplete && (
                <MdTextButton
                  type="button"
                  disabled={saving || testingNotifications}
                  onClick={() => revertSettings("notifications")}
                >
                  Revert
                </MdTextButton>
              )}
              {saved?.notifications?.discord_webhook_configured && (
                <MdTextButton
                  type="button"
                  disabled={saving || testingNotifications}
                  onClick={() => void removeDiscordWebhook()}
                >
                  Remove webhook
                </MdTextButton>
              )}
              <MdOutlinedButton
                type="button"
                disabled={
                  saving ||
                  testingNotifications ||
                  !saved?.notifications?.discord_webhook_configured ||
                  discordWebhookChanged
                }
                onClick={() => void testNotifications()}
              >
                {testingNotifications ? "Sending…" : "Send test"}
              </MdOutlinedButton>
              <MdFilledButton type="submit" disabled={saving || !notificationSettingsValid}>
                {saving ? "Saving…" : "Save notifications"}
              </MdFilledButton>
            </div>
          </footer>
          {notice && <div className="message success bottom-notice" role="status">{notice}</div>}
          {visibleError && (
            <div className="message error bottom-message" role="alert">
              <strong>Couldn’t continue.</strong> {visibleError}
            </div>
          )}
        </form>
      )}
    </main>
  );
}
