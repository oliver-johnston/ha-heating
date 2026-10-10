import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  MdCheckbox,
  MdFilledButton,
  MdOutlinedButton,
  MdOutlinedSelect,
  MdOutlinedTextField,
  MdPrimaryTab,
  MdSelectOption,
  MdSwitch,
  MdTabs,
  MdTextButton,
} from "./material";

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
  control_source: "schedule" | "away" | "boost";
  override_until: string | null;
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
  scheduled_temperature: number;
  preset: PresetKey;
  demand: boolean;
  commanded_temperature: number;
  reported_target_temperature: number | null;
  hvac_mode: string | null;
  hvac_action: string | null;
  warning: string | null;
  control_source: "schedule" | "away" | "boost";
  override_until: string | null;
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
type ControlValues = Record<
  | "cycle_interval_seconds"
  | "heating_offset"
  | "idle_offset"
  | "hysteresis"
  | "frost_protection_temperature"
  | "minimum_boiler_on_seconds"
  | "minimum_boiler_off_seconds"
  | "maximum_boiler_on_seconds"
  | "command_retries"
  | "failures_before_alert"
  | "external_sensor_stale_seconds"
  | "trv_stale_seconds",
  string
> & {
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
  away_preset: "eco",
  cycle_interval_seconds: "30",
  heating_offset: "2",
  idle_offset: "2",
  hysteresis: "0.2",
  smart_temperature_control: false,
  open_window_detection: false,
  child_lock: false,
  frost_protection_temperature: "5",
  minimum_boiler_on_seconds: "300",
  minimum_boiler_off_seconds: "300",
  maximum_boiler_on_seconds: "14400",
  command_retries: "2",
  failures_before_alert: "3",
  external_sensor_stale_seconds: "5400",
  trv_stale_seconds: "3600",
};
const DEFAULT_NOTIFICATIONS: NotificationValues = {
  enabled: false,
  level: "critical",
  send_recovery: true,
  warning_delay_minutes: "15",
};

function notificationValues(settings: NotificationSettings | undefined): NotificationValues {
  if (!settings) return DEFAULT_NOTIFICATIONS;
  return {
    enabled: settings.enabled,
    level: settings.level,
    send_recovery: settings.send_recovery,
    warning_delay_minutes: String(settings.warning_delay_seconds / 60),
  };
}

function controlValues(settings: ControlSettings | undefined): ControlValues {
  if (!settings) return DEFAULT_CONTROL;
  return {
    enabled: settings.enabled,
    away_preset: settings.away_preset ?? "eco",
    cycle_interval_seconds: String(settings.cycle_interval_seconds),
    heating_offset: String(settings.heating_offset),
    idle_offset: String(settings.idle_offset),
    hysteresis: String(settings.hysteresis),
    smart_temperature_control: settings.smart_temperature_control,
    open_window_detection: settings.open_window_detection,
    child_lock: settings.child_lock,
    frost_protection_temperature: String(settings.frost_protection_temperature),
    minimum_boiler_on_seconds: String(settings.minimum_boiler_on_seconds),
    minimum_boiler_off_seconds: String(settings.minimum_boiler_off_seconds),
    maximum_boiler_on_seconds: String(settings.maximum_boiler_on_seconds ?? 14400),
    command_retries: String(settings.command_retries ?? 2),
    failures_before_alert: String(settings.failures_before_alert ?? 3),
    external_sensor_stale_seconds: String(settings.external_sensor_stale_seconds ?? 5400),
    trv_stale_seconds: String(settings.trv_stale_seconds ?? 3600),
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
    minimum_boiler_on_seconds: Number(settings.minimum_boiler_on_seconds),
    minimum_boiler_off_seconds: Number(settings.minimum_boiler_off_seconds),
    maximum_boiler_on_seconds: Number(settings.maximum_boiler_on_seconds),
    command_retries: Number(settings.command_retries),
    failures_before_alert: Number(settings.failures_before_alert),
    external_sensor_stale_seconds: Number(settings.external_sensor_stale_seconds),
    trv_stale_seconds: Number(settings.trv_stale_seconds),
  };
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

function friendlyRole(role: string) {
  return role.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function scheduleValueName(value: string) {
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

function formatTemperature(value: number | null, unit: string) {
  if (value === null) return "Unavailable";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}${unit}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatAge(seconds: number | null) {
  if (seconds === null) return "time unavailable";
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} seconds ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  return `${Math.round(seconds / 3600)} hours ago`;
}

function formatNextSchedule(room: DashboardRoom) {
  if (!room.next_schedule_at || !room.next_preset || room.next_scheduled_temperature === null) {
    return "No further scheduled change";
  }
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(room.next_schedule_at));
  return `Next ${scheduleValueName(room.next_preset)} · ${formatTemperature(
    room.next_scheduled_temperature,
    room.unit,
  )} · ${when}`;
}

function formatNextHotWaterChange(controller: DashboardData["controller"]) {
  if (!controller.hot_water_next_change_at || !controller.hot_water_next_state) {
    return "No further scheduled change";
  }
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(controller.hot_water_next_change_at));
  return `Next ${onOffLabel(controller.hot_water_next_state === "on")} · ${when}`;
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

function formatBoostExpiry(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
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
      setDiscordWebhook("");
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
      const nextSelections: Record<string, Selection> = {};
      for (const trv of found.trvs) {
        const configured = existingByDevice.get(trv.device_id);
        const externalTemperatureSensor =
          configured?.external_temperature_sensor ?? trv.suggested_temperature_sensor ?? "";
        const suggestedExternalLastSeen = found.temperature_sensors.find(
          (sensor) => sensor.entity_id === externalTemperatureSensor,
        )?.suggested_last_seen_entity;
        const externalLastSeen =
          configured?.external_temperature_last_seen ?? suggestedExternalLastSeen ?? "";
        const configuredExternalFreshness =
          configured?.external_temperature_freshness ?? "auto";
        nextSelections[trv.device_id] = {
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
      setDiscovery(found);
      setScreen(
        openSettings
          ? settingsScreen
          : existing && !existing.setup.boiler
            ? "boiler"
            : existing && !existing.setup.control
              ? "control"
            : existing && !existing.setup.presets
              ? "presets"
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
  const notificationSettingsValid =
    Number.isFinite(warningDelayMinutes) &&
    warningDelayMinutes >= 1 &&
    warningDelayMinutes <= 1440 &&
    (!notifications.enabled || Boolean(saved?.notifications?.discord_webhook_configured || discordWebhook));
  const setupComplete = saved?.setup.schedules ?? false;
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

  function changeSettingsTab(event: Event) {
    const index = (event.currentTarget as EventTarget & { activeTabIndex: number })
      .activeTabIndex;
    const nextScreen = SETTINGS_SCREENS[index];
    if (nextScreen) showScreen(nextScreen);
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
      setNotice(
        body.relays_confirmed_off
          ? "Automatic control is disabled and both relays are confirmed off."
          : "Automatic control is disabled, but one or more relay states could not be confirmed.",
      );
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
      setNotice("Safety stop acknowledged. Automatic control will resume.");
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
      setNotice(`${mode === "home" ? "Home" : "Away"} mode is active.`);
      await loadDashboard(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOverrideSaving("");
    }
  }

  async function startBoost(roomGroup: string | null, durationMinutes: number) {
    const target = roomGroup ?? "all";
    setOverrideSaving(`boost:${target}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("boost"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_group: roomGroup, duration_minutes: durationMinutes }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not start boost");
      setNotice(
        `${roomGroup ?? "Whole-house"} boost started for ${durationMinutes} minutes.`,
      );
      await loadDashboard(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOverrideSaving("");
    }
  }

  async function cancelBoost(roomGroup: string | null) {
    const target = roomGroup ?? "all";
    setOverrideSaving(`boost:${target}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("boost/cancel"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_group: roomGroup }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not cancel boost");
      setNotice(`${roomGroup ?? "Whole-house"} boost cancelled.`);
      await loadDashboard(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOverrideSaving("");
    }
  }

  async function startHotWaterBoost(durationMinutes: number) {
    setOverrideSaving("hot-water-boost");
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("hot-water/boost"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_minutes: durationMinutes }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not start hot-water boost");
      setNotice(`Hot-water boost started for ${durationMinutes} minutes.`);
      await loadDashboard(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOverrideSaving("");
    }
  }

  async function cancelHotWaterBoost() {
    setOverrideSaving("hot-water-boost");
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("hot-water/boost/cancel"), { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not cancel hot-water boost");
      setNotice("Hot-water boost cancelled.");
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
      if (skip) {
        setScreen("control");
      } else {
        setNotice("Boiler settings saved.");
        if (!setupComplete) setScreen("control");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveControl(event: FormEvent) {
    event.preventDefault();
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
        setNotice(
          config.control.enabled
            ? "Automatic control enabled and the first cycle completed."
            : "Control settings saved. Automatic control is off.",
        );
      }
      if (!setupComplete) setScreen("presets");
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
      if (!setupComplete) setScreen("schedules");
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
          discord_webhook_url: discordWebhook || null,
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
      setDiscordWebhook("");
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
    return <main className="shell"><div className="loading">Discovering the heating system…</div></main>;
  }

  return (
    <main className="shell">
      <div className="app-heading">
        <p className="eyebrow">Home Heating</p>
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
      </div>
      {setupComplete && (
        <MdTabs
          className="app-tabs"
          activeTabIndex={screen === "dashboard" ? 0 : screen === "diagnostics" ? 2 : 1}
          onChange={changeAppTab}
          aria-label="Home Heating"
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
      {(screen === "dashboard" || screen === "diagnostics") && (
        <div className="page-actions">
          <div className="header-actions">
            <div className="dashboard-actions">
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
          </div>
        </div>
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
          <MdTabs
            className={`config-tabs ${screen === "devices" ? "with-actions" : ""}`}
            activeTabIndex={SETTINGS_SCREENS.indexOf(screen)}
            onChange={changeSettingsTab}
            aria-label="Heating configuration"
          >
            <MdPrimaryTab active={screen === "devices"}>Devices</MdPrimaryTab>
            <MdPrimaryTab active={screen === "boiler"}>Boiler</MdPrimaryTab>
            <MdPrimaryTab active={screen === "control"}>Control</MdPrimaryTab>
            <MdPrimaryTab active={screen === "presets"}>Presets</MdPrimaryTab>
            <MdPrimaryTab active={screen === "schedules"}>Schedules</MdPrimaryTab>
            <MdPrimaryTab active={screen === "notifications"}>Notifications</MdPrimaryTab>
          </MdTabs>
        ) : (
          <ol className="onboarding-progress" aria-label="Onboarding progress">
            <li className={screen === "devices" ? "active" : "complete"}>
              <span>1</span>
              Devices
            </li>
            <li
              className={
                screen === "boiler"
                  ? "active"
                  : screen === "control" || screen === "presets" || screen === "schedules" || saved?.setup.boiler
                    ? "complete"
                    : "pending"
              }
            >
              <span>2</span>
              Boiler
              <small>Optional</small>
            </li>
            <li
              className={
                screen === "control"
                  ? "active"
                  : screen === "presets" || screen === "schedules" || saved?.setup.control
                    ? "complete"
                    : "pending"
              }
            >
              <span>3</span>
              Control
            </li>
            <li
              className={
                screen === "presets"
                  ? "active"
                  : screen === "schedules" || saved?.setup.presets
                    ? "complete"
                    : "pending"
              }
            >
              <span>4</span>
              Presets
            </li>
            <li className={screen === "schedules" ? "active" : "pending"}>
              <span>5</span>
              Schedules
            </li>
          </ol>
        ))}

      {screen === "devices" && (
        <div className="page-actions device-actions">
          <MdTextButton type="button" onClick={() => void load(true)}>
            Rescan devices
          </MdTextButton>
        </div>
      )}

      {visibleError && (
        <div className="message error"><strong>Couldn’t continue.</strong> {visibleError}</div>
      )}
      {notice && <div className="message success">{notice}</div>}

      {screen === "dashboard" ? (
        <section className="dashboard" aria-live="polite">
          {dashboardLoading && !dashboard ? (
            <div className="loading">Loading room temperatures…</div>
          ) : dashboard ? (
            <div className="dashboard-content">
              <section className="override-panel" aria-label="Heating mode and whole-house boost">
                <div className="mode-control">
                  <div>
                    <strong>Heating mode</strong>
                    <span>
                      {dashboard.overrides.mode === "home"
                        ? "Following room schedules"
                        : `Away · ${scheduleValueName(dashboard.overrides.away_preset)}`}
                    </span>
                  </div>
                  <div className="segmented-actions">
                    {dashboard.overrides.mode === "home" ? (
                      <MdFilledButton type="button">Home</MdFilledButton>
                    ) : (
                      <MdOutlinedButton
                        type="button"
                        disabled={Boolean(overrideSaving)}
                        onClick={() => void setHeatingMode("home")}
                      >
                        Home
                      </MdOutlinedButton>
                    )}
                    {dashboard.overrides.mode === "away" ? (
                      <MdFilledButton type="button">Away</MdFilledButton>
                    ) : (
                      <MdOutlinedButton
                        type="button"
                        disabled={Boolean(overrideSaving)}
                        onClick={() => void setHeatingMode("away")}
                      >
                        Away
                      </MdOutlinedButton>
                    )}
                  </div>
                </div>
                {(() => {
                  const boost = dashboard.overrides.boosts.find(
                    (active) => active.room_group === null,
                  );
                  return (
                    <div className="boost-control">
                      <div>
                        <strong>Whole house boost</strong>
                        <span>
                          {boost
                            ? `Boost until ${formatBoostExpiry(boost.expires_at)}`
                            : `${scheduleValueName("boost")} · ${formatTemperature(saved?.presets.boost ?? null, "°C")}`}
                        </span>
                      </div>
                      <div className="boost-actions">
                        {boost ? (
                          <MdOutlinedButton
                            type="button"
                            disabled={Boolean(overrideSaving)}
                            onClick={() => void cancelBoost(null)}
                          >
                            Cancel boost
                          </MdOutlinedButton>
                        ) : (
                          [30, 60, 120, 240].map((minutes) => (
                            <MdOutlinedButton
                              type="button"
                              key={minutes}
                              disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                              onClick={() => void startBoost(null, minutes)}
                            >
                              {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
                            </MdOutlinedButton>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })()}
              </section>
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
                  <div className="room-grid relay-status-grid">
                    {saved.boiler_switch && (() => {
                      const status = relayStatus(
                        dashboard.controller.boiler_is_on,
                        dashboard.controller.boiler_should_be_on,
                      );
                      return (
                        <article className={`room-card relay-status-card relay-status-${status}`}>
                          <div className="room-card-title">
                            <h3 className="md-typescale-title-large">Central heating</h3>
                            <span className={`room-status-badge relay-status-${status}`}>
                              {RELAY_STATUS_LABELS[status]}
                            </span>
                          </div>
                          <div className="temperature-readings relay-status-readings">
                            <div className="current-reading">
                              <span>Actual</span>
                              <strong>{onOffLabel(dashboard.controller.boiler_is_on)}</strong>
                            </div>
                            <div className="scheduled-reading">
                              <span>Requested</span>
                              <strong>{onOffLabel(dashboard.controller.boiler_should_be_on)}</strong>
                            </div>
                          </div>
                          <div className="room-technical-state">
                            <span>
                              {dashboard.controller.heat_requests} of {dashboard.controller.minimum_heat_requests} required heat requests
                            </span>
                          </div>
                        </article>
                      );
                    })()}
                    {saved.hot_water_switch && (() => {
                      const status = relayStatus(
                        dashboard.controller.hot_water_is_on,
                        dashboard.controller.hot_water_should_be_on,
                      );
                      const boost = dashboard.overrides.hot_water_boost;
                      return (
                        <article className={`room-card relay-status-card relay-status-${status}`}>
                          <div className="room-card-title">
                            <h3 className="md-typescale-title-large">Hot water</h3>
                            <span className={`room-status-badge relay-status-${status}`}>
                              {RELAY_STATUS_LABELS[status]}
                            </span>
                          </div>
                          <div className="temperature-readings relay-status-readings">
                            <div className="current-reading">
                              <span>Actual</span>
                              <strong>{onOffLabel(dashboard.controller.hot_water_is_on)}</strong>
                            </div>
                            <div className="scheduled-reading">
                              <span>Requested</span>
                              <strong>
                                {onOffLabel(dashboard.controller.hot_water_should_be_on)}
                              </strong>
                            </div>
                          </div>
                          <div className="room-technical-state">
                            <span>
                              {boost
                                ? `Boost until ${formatBoostExpiry(boost.expires_at)}`
                                : formatNextHotWaterChange(dashboard.controller)}
                            </span>
                            <div className="boost-actions hot-water-boost-actions">
                              {boost ? (
                               <MdOutlinedButton
                                 type="button"
                                  disabled={Boolean(overrideSaving)}
                                  onClick={() => void cancelHotWaterBoost()}
                               >
                                  Cancel boost
                               </MdOutlinedButton>
                              ) : (
                                [30, 60, 120, 240].map((minutes) => (
                                  <MdOutlinedButton
                                    type="button"
                                    key={minutes}
                                    disabled={
                                      !dashboard.controller.enabled || Boolean(overrideSaving)
                                    }
                                    onClick={() => void startHotWaterBoost(minutes)}
                                  >
                                    {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
                                  </MdOutlinedButton>
                                ))
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })()}
                  </div>
                </section>
              )}
              <div className="room-groups">
              {dashboard.groups.map((group) => {
                const boost = dashboard.overrides.boosts.find(
                  (active) => active.room_group === group.name,
                );
                return <section className="room-group" key={group.name}>
                  <header className="room-group-header">
                    <div>
                      <h2 className="md-typescale-headline-small">{group.name}</h2>
                      <span>{group.rooms.length} room{group.rooms.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="boost-actions room-boost-actions">
                      {boost ? (
                        <>
                          <span>Boost until {formatBoostExpiry(boost.expires_at)}</span>
                          <MdOutlinedButton
                            type="button"
                            disabled={Boolean(overrideSaving)}
                            onClick={() => void cancelBoost(group.name)}
                          >
                            Cancel
                          </MdOutlinedButton>
                        </>
                      ) : (
                        [30, 60, 120, 240].map((minutes) => (
                          <MdOutlinedButton
                            type="button"
                            key={minutes}
                            disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                            onClick={() => void startBoost(group.name, minutes)}
                          >
                            {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
                          </MdOutlinedButton>
                        ))
                      )}
                    </div>
                  </header>
                  <div className="room-grid">
                    {group.rooms.map((room) => (
                      <article className={`room-card room-status-${room.status}`} key={room.device_id}>
                        <div className="room-card-title">
                          <div>
                            <h3 className="md-typescale-title-large">{room.name}</h3>
                            {room.trv_name !== room.name && <span>{room.trv_name}</span>}
                          </div>
                          <span className={`room-status-badge room-status-${room.status}`}>
                            {ROOM_STATUS_LABELS[room.status]}
                          </span>
                        </div>
                        <div className="temperature-readings">
                          <div className="current-reading">
                            <span>Actual</span>
                            <strong>{formatTemperature(room.current_temperature, room.unit)}</strong>
                          </div>
                          <div className="scheduled-reading">
                            <span>
                              {room.control_source === "boost"
                                ? "Boost"
                                : room.control_source === "away"
                                  ? "Away"
                                  : "Scheduled"}
                            </span>
                            <strong>
                              {scheduleValueName(room.preset)} · {formatTemperature(room.scheduled_temperature, room.unit)}
                            </strong>
                          </div>
                        </div>
                        <div className="room-technical-state">
                          <span>TRV command {formatTemperature(room.commanded_temperature, room.unit)}</span>
                          {room.external_temperature !== null && (
                            <span>TRV sensor {formatTemperature(room.trv_temperature, room.unit)}</span>
                          )}
                          <span>TRV reports target {formatTemperature(room.target_temperature, room.unit)}</span>
                          {room.external_temperature_freshness === "disabled" ? (
                            <span>Room sensor freshness check disabled</span>
                          ) : room.external_temperature_health_entity ? (
                            <span title={room.external_temperature_health_entity}>
                              {room.external_temperature_freshness === "state_updates"
                                ? "Room temperature updated"
                                : "Room sensor last seen"}{" "}
                              {formatAge(room.external_temperature_age_seconds)}
                            </span>
                          ) : null}
                          {room.trv_last_seen_at && (
                            <span>
                              TRV last seen {formatAge(
                                Math.max(
                                  0,
                                  (Date.now() - new Date(room.trv_last_seen_at).getTime()) / 1000,
                                ),
                              )}
                            </span>
                          )}
                          <span>{formatNextSchedule(room)}</span>
                          {room.override_until && (
                            <span>Boost ends {formatBoostExpiry(room.override_until)}</span>
                          )}
                          {room.warning && <span className="room-warning">{room.warning}</span>}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>;
              })}
              </div>
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
                  <h2 className="md-typescale-headline-small">Room decisions</h2>
                  <span>{diagnostics.rooms.length}</span>
                </header>
                <div className="diagnostic-room-list">
                  {diagnostics.rooms.map((room) => (
                    <article className="diagnostic-room" key={room.device_id}>
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
                          <dt>
                            {room.control_source === "boost"
                              ? "Boost"
                              : room.control_source === "away"
                                ? "Away"
                                : "Scheduled"}
                          </dt>
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
                      <div className="diagnostic-room-technical">
                        <span>{room.temperature_source} sensor · {room.temperature_entity}</span>
                        <span>Mode {room.hvac_mode ?? "unknown"} · Action {room.hvac_action ?? "unknown"}</span>
                        <span>Reported target {formatTemperature(room.reported_target_temperature, "°C")}</span>
                      </div>
                    </article>
                  ))}
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
          <section className="section-heading">
            <div>
              <h2 className="md-typescale-headline-small">Radiator valves</h2>
              <p>Select each room you want to control.</p>
            </div>
            <span className="selection-count">
              {selectedCount} of {discovery.trvs.length} selected
            </span>
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
                      <div className="trv-fields">
                        <MdOutlinedTextField
                          required
                          maxLength={80}
                          label="Room group"
                          value={selection.room_group}
                          onInput={(event) =>
                            updateSelection(trv.device_id, { room_group: eventValue(event) })
                          }
                        />
                        <MdOutlinedSelect
                          label="External temperature sensor (optional)"
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
                        {selection.external_temperature_sensor && (
                          <>
                            <MdOutlinedSelect
                              label="External sensor health"
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
                            {selection.external_temperature_freshness !== "disabled" && (
                              <MdOutlinedTextField
                                type="number"
                                min="5"
                                max="1440"
                                step="5"
                                label="Stale after (minutes, optional)"
                                supportingText={`Blank uses the system default (${Math.round(
                                  Number(control.external_sensor_stale_seconds) / 60,
                                )} minutes)`}
                                value={selection.external_sensor_stale_minutes}
                                onInput={(event) =>
                                  updateSelection(trv.device_id, {
                                    external_sensor_stale_minutes: eventValue(event),
                                  })
                                }
                              />
                            )}
                          </>
                        )}
                        <details>
                          <summary>
                            Technical details · {Object.values(trv.entities).filter(Boolean).length} entities
                          </summary>
                          <MdOutlinedSelect
                            className="technical-health-select"
                            label="TRV health"
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
              <h2 className="md-typescale-headline-small">Boiler and hot water</h2>
              <p>Optional. Choose the switches this add-on should control.</p>
            </div>
          </section>

          <section className="plant-card boiler-card">
            <MdOutlinedSelect
              label="Heating switch (optional)"
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
            <MdOutlinedSelect
              label="Hot-water switch (optional)"
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
            <div className="heat-request-setting">
              <div>
                <strong>Radiators required to start heating</strong>
                <span>
                  The heating switch turns on when at least this many radiators request heat.
                </span>
              </div>
              <MdOutlinedTextField
                required
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
            </div>
          </section>

          <footer className="save-bar">
            <div className="save-actions">
              <MdTextButton type="button" onClick={() => showScreen("devices")}>Back</MdTextButton>
              {!saved?.setup.boiler && (
                <MdTextButton
                  type="button"
                  disabled={saving}
                  onClick={() => void persistBoilerSettings(true)}
                >
                  Skip for now
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

          <section className="control-card">
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
            <label className="control-toggle primary-control-toggle">
              <MdSwitch
                aria-label="Automatic control"
                selected={control.enabled}
                disabled={saved?.safety?.fault_latched && !control.enabled}
                onChange={(event) => toggleAutomaticControl(eventSelected(event))}
              />
              <span>
                <strong>Automatic control</strong>
                <small>
                  Disabling turns controlled relays off; decisions then remain visible without writes.
                </small>
              </span>
            </label>

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

            <div className="control-fields">
              <MdOutlinedSelect label="TRV mode" value="heat" disabled>
                <MdSelectOption value="heat" displayText="Heat">Heat</MdSelectOption>
              </MdOutlinedSelect>
              <MdOutlinedSelect label="TRV temperature source" value="internal" disabled>
                <MdSelectOption value="internal" displayText="Internal sensor">
                  Internal sensor
                </MdSelectOption>
              </MdOutlinedSelect>
              <MdOutlinedSelect
                label="Away mode preset"
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
              <MdOutlinedTextField
                required
                type="number"
                min="10"
                max="300"
                step="1"
                label="Control cycle (seconds)"
                value={control.cycle_interval_seconds}
                onInput={(event) => updateControl({ cycle_interval_seconds: eventValue(event) })}
              />
              <MdOutlinedTextField
                required
                type="number"
                min="0"
                max="2"
                step="0.1"
                label="Hysteresis °C"
                value={control.hysteresis}
                onInput={(event) => updateControl({ hysteresis: eventValue(event) })}
              />
              <MdOutlinedTextField
                required
                type="number"
                min="0.5"
                max="10"
                step="0.5"
                label="Heating offset °C"
                value={control.heating_offset}
                onInput={(event) => updateControl({ heating_offset: eventValue(event) })}
              />
              <MdOutlinedTextField
                required
                type="number"
                min="0.5"
                max="10"
                step="0.5"
                label="Idle offset °C"
                value={control.idle_offset}
                onInput={(event) => updateControl({ idle_offset: eventValue(event) })}
              />
              <MdOutlinedTextField
                required
                type="number"
                min="4"
                max="35"
                step="0.5"
                label="Frost protection °C"
                value={control.frost_protection_temperature}
                onInput={(event) =>
                  updateControl({ frost_protection_temperature: eventValue(event) })
                }
              />
              <MdOutlinedTextField
                required
                type="number"
                min="0"
                max="3600"
                step="30"
                label="Minimum boiler on (seconds)"
                value={control.minimum_boiler_on_seconds}
                onInput={(event) =>
                  updateControl({ minimum_boiler_on_seconds: eventValue(event) })
                }
              />
              <MdOutlinedTextField
                required
                type="number"
                min="0"
                max="3600"
                step="30"
                label="Minimum boiler off (seconds)"
                value={control.minimum_boiler_off_seconds}
                onInput={(event) =>
                  updateControl({ minimum_boiler_off_seconds: eventValue(event) })
                }
              />
              <MdOutlinedTextField
                required
                type="number"
                min="300"
                max="21600"
                step="300"
                label="Maximum continuous boiler run (seconds)"
                value={control.maximum_boiler_on_seconds}
                onInput={(event) =>
                  updateControl({ maximum_boiler_on_seconds: eventValue(event) })
                }
              />
              <MdOutlinedTextField
                required
                type="number"
                min="0"
                max="5"
                step="1"
                label="Command retries"
                value={control.command_retries}
                onInput={(event) => updateControl({ command_retries: eventValue(event) })}
              />
              <MdOutlinedTextField
                required
                type="number"
                min="1"
                max="10"
                step="1"
                label="Failed cycles before alert"
                value={control.failures_before_alert}
                onInput={(event) => updateControl({ failures_before_alert: eventValue(event) })}
              />
              <MdOutlinedTextField
                required
                type="number"
                min="300"
                max="86400"
                step="300"
                label="External sensor stale after (seconds)"
                value={control.external_sensor_stale_seconds}
                onInput={(event) =>
                  updateControl({ external_sensor_stale_seconds: eventValue(event) })
                }
              />
              <MdOutlinedTextField
                required
                type="number"
                min="300"
                max="86400"
                step="300"
                label="TRV stale after (seconds)"
                value={control.trv_stale_seconds}
                onInput={(event) => updateControl({ trv_stale_seconds: eventValue(event) })}
              />
            </div>

            <div className="managed-settings">
              <label className="control-toggle">
                <MdSwitch
                  aria-label="Smart temperature control"
                  selected={control.smart_temperature_control}
                  onChange={(event) =>
                    updateControl({ smart_temperature_control: eventSelected(event) })
                  }
                />
                <span><strong>Smart temperature control</strong><small>Off by default.</small></span>
              </label>
              <label className="control-toggle">
                <MdSwitch
                  aria-label="Open-window detection"
                  selected={control.open_window_detection}
                  onChange={(event) =>
                    updateControl({ open_window_detection: eventSelected(event) })
                  }
                />
                <span><strong>Open-window detection</strong><small>Off by default.</small></span>
              </label>
              <label className="control-toggle">
                <MdSwitch
                  aria-label="Child lock"
                  selected={control.child_lock}
                  onChange={(event) => updateControl({ child_lock: eventSelected(event) })}
                />
                <span>
                  <strong>Child lock</strong>
                  <small>Leave off so the valve remains directly adjustable.</small>
                </span>
              </label>
            </div>
          </section>

          <footer className="save-bar">
            <div className="save-actions">
              <MdTextButton type="button" onClick={() => showScreen("boiler")}>Back</MdTextButton>
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

          <section className="preset-grid">
            {PRESET_DEFINITIONS.map((preset) => (
              <article className="preset-card" key={preset.key}>
                <div>
                  <h3 className="md-typescale-title-large">{preset.name}</h3>
                  <p>{preset.description}</p>
                </div>
                <MdOutlinedTextField
                  required
                  label="Temperature °C"
                  type="number"
                  min="5"
                  max="30"
                  step="0.5"
                  value={presets[preset.key]}
                  onInput={(event) => updatePreset(preset.key, eventValue(event))}
                />
              </article>
            ))}
          </section>

          <footer className="save-bar">
            <div className="save-actions">
              <MdTextButton type="button" onClick={() => showScreen("control")}>Back</MdTextButton>
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
              <MdTextButton type="button" onClick={() => showScreen("presets")}>Back</MdTextButton>
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

          <section className="control-card notification-card">
            <label className="control-toggle primary-control-toggle">
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
              <span>
                <strong>Discord notifications</strong>
                <small>Home Assistant persistent safety notifications remain enabled.</small>
              </span>
            </label>

            <div className="notification-fields">
              <MdOutlinedTextField
                label="Discord webhook URL"
                type="password"
                value={discordWebhook}
                supportingText={
                  saved?.notifications?.discord_webhook_configured
                    ? "A webhook is configured. Leave blank to keep it, or enter a new URL to replace it."
                    : "Create a webhook in the Discord channel settings and paste its URL here."
                }
                onInput={(event) => {
                  setDiscordWebhook(eventValue(event));
                  setNotice("");
                }}
              />
              <MdOutlinedSelect
                label="Notification level"
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
              {notifications.level === "warning" && (
                <MdOutlinedTextField
                  required
                  label="Warn after (minutes)"
                  type="number"
                  min="1"
                  max="1440"
                  step="1"
                  value={notifications.warning_delay_minutes}
                  supportingText="Prevents brief sensor dropouts from sending alerts."
                  onInput={(event) => {
                    const warningDelayMinutes = eventValue(event);
                    setNotifications((current) => ({
                      ...current,
                      warning_delay_minutes: warningDelayMinutes,
                    }));
                    setNotice("");
                  }}
                />
              )}
            </div>

            <label className="control-toggle">
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
              <span>
                <strong>Recovery notifications</strong>
                <small>Send one message when a reported problem returns to normal.</small>
              </span>
            </label>

            <p className="notification-security-note">
              The webhook is stored in the add-on configuration and omitted from the UI,
              logs, and downloaded diagnostics.
            </p>
          </section>

          <footer className="save-bar">
            <div className="save-actions notification-actions">
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
                  Boolean(discordWebhook)
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
