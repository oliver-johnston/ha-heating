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
};

type Discovery = {
  trvs: DiscoveredTRV[];
  temperature_sensors: EntityOption[];
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
};

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
  smart_temperature_control: boolean;
  open_window_detection: boolean;
  child_lock: boolean;
  frost_protection_temperature: number;
  minimum_boiler_on_seconds: number;
  minimum_boiler_off_seconds: number;
};

type SavedConfig = {
  boiler_switch: string | null;
  hot_water_switch: string | null;
  minimum_heat_requests: number;
  control: ControlSettings;
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
  status: "heating" | "waiting" | "opening" | "closing" | "idle" | "unavailable";
  hvac_mode: string | null;
  hvac_action: string | null;
  warning: string | null;
  unit: string;
  available: boolean;
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
  };
  issues: DiagnosticIssue[];
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
    loop_status: "starting" | "healthy" | "overdue" | "error";
    cycle_interval_seconds: number;
    last_cycle_started_at: string | null;
    last_cycle_finished_at: string | null;
    last_successful_cycle_at: string | null;
    last_error: string | null;
    latest_actions: string[];
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
};

type PresetValues = Record<PresetKey, string>;
type ControlValues = Record<
  | "cycle_interval_seconds"
  | "heating_offset"
  | "idle_offset"
  | "hysteresis"
  | "frost_protection_temperature"
  | "minimum_boiler_on_seconds"
  | "minimum_boiler_off_seconds",
  string
> & {
  enabled: boolean;
  smart_temperature_control: boolean;
  open_window_detection: boolean;
  child_lock: boolean;
};
type SettingsScreen = "devices" | "boiler" | "control" | "presets" | "schedules";
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
};
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
  unavailable: "Unavailable",
};

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

export default function App() {
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [saved, setSaved] = useState<SavedConfig | null>(null);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [boilerSwitch, setBoilerSwitch] = useState("");
  const [hotWaterSwitch, setHotWaterSwitch] = useState("");
  const [minimumHeatRequests, setMinimumHeatRequests] = useState("1");
  const [control, setControl] = useState<ControlValues>(DEFAULT_CONTROL);
  const [presets, setPresets] = useState<PresetValues>(DEFAULT_PRESETS);
  const [schedules, setSchedules] = useState<RoomSchedule[]>([]);
  const [hotWaterSchedule, setHotWaterSchedule] = useState<HotWaterSchedule>(
    DEFAULT_HOT_WATER_SCHEDULE,
  );
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
      setControl(
        existing?.control
          ? {
              enabled: existing.control.enabled,
              cycle_interval_seconds: String(existing.control.cycle_interval_seconds),
              heating_offset: String(existing.control.heating_offset),
              idle_offset: String(existing.control.idle_offset),
              hysteresis: String(existing.control.hysteresis),
              smart_temperature_control: existing.control.smart_temperature_control,
              open_window_detection: existing.control.open_window_detection,
              child_lock: existing.control.child_lock,
              frost_protection_temperature: String(existing.control.frost_protection_temperature),
              minimum_boiler_on_seconds: String(existing.control.minimum_boiler_on_seconds),
              minimum_boiler_off_seconds: String(existing.control.minimum_boiler_off_seconds),
            }
          : DEFAULT_CONTROL,
      );
      setSelectedRoomGroup(nextSchedules[0]?.room_group ?? "");

      if (existing?.setup.schedules && !openSettings) {
        setScreen("dashboard");
        await loadDashboard();
        return;
      }

      const discoveryResponse = await fetch(api("onboarding/discovery"));
      const discoveryBody = await discoveryResponse.json();
      if (!discoveryResponse.ok) throw new Error(discoveryBody.error || "Discovery failed");
      const found = discoveryBody as Discovery;
      const existingByDevice = new Map(existing?.trvs.map((trv) => [trv.device_id, trv]));
      const nextSelections: Record<string, Selection> = {};
      for (const trv of found.trvs) {
        const configured = existingByDevice.get(trv.device_id);
        nextSelections[trv.device_id] = {
          enabled: configured ? true : existing === null,
          room_group: configured?.room_group ?? trv.area_name ?? trv.suggested_group,
          external_temperature_sensor:
            configured?.external_temperature_sensor ?? trv.suggested_temperature_sensor ?? "",
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
    setNotice("");
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
      setSchedules(nextSchedules);
      setHotWaterSchedule(config.hot_water_schedule ?? DEFAULT_HOT_WATER_SCHEDULE);
      setSelectedRoomGroup((current) =>
        nextSchedules.some((schedule) => schedule.room_group === current)
          ? current
          : nextSchedules[0]?.room_group ?? "",
      );
      setNotice("Configuration saved and verified against Home Assistant.");
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
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("control"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: control.enabled,
          cycle_interval_seconds: Number(control.cycle_interval_seconds),
          heating_offset: Number(control.heating_offset),
          idle_offset: Number(control.idle_offset),
          hysteresis: Number(control.hysteresis),
          trv_mode: "heat",
          temperature_source: "internal",
          smart_temperature_control: control.smart_temperature_control,
          open_window_detection: control.open_window_detection,
          child_lock: control.child_lock,
          frost_protection_temperature: Number(control.frost_protection_temperature),
          minimum_boiler_on_seconds: Number(control.minimum_boiler_on_seconds),
          minimum_boiler_off_seconds: Number(control.minimum_boiler_off_seconds),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save control settings");
      setSaved(body.config as SavedConfig);
      setNotice("Control settings saved.");
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
      setSaved(body.config as SavedConfig);
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

  if (loading) {
    return <main className="shell"><div className="loading">Discovering the heating system…</div></main>;
  }

  return (
    <main className="shell">
      <div className="app-heading">
        <p className="eyebrow">Home Heating</p>
        <div className={`status ${setupComplete ? "configured" : saved ? "progress" : "draft"}`}>
          <span className="status-dot" />
          {setupComplete ? "Configured" : saved ? "Setup in progress" : "Not configured"}
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
                disabled={screen === "dashboard" ? dashboardLoading : diagnosticsLoading}
                onClick={() =>
                  screen === "dashboard" ? void loadDashboard() : void loadDiagnostics()
                }
              >
                {(screen === "dashboard" ? dashboardLoading : diagnosticsLoading)
                  ? "Refreshing…"
                  : "Refresh"}
              </MdOutlinedButton>
            </div>
          </div>
        </div>
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
              <section className={`controller-summary ${dashboard.controller.enabled ? "active" : ""}`}>
                <div>
                  <strong>{dashboard.controller.enabled ? "Automatic control running" : "Heat demand"}</strong>
                  <span>
                    {dashboard.controller.heat_requests} of {dashboard.controller.minimum_heat_requests} required heat requests
                  </span>
                </div>
              </section>
              <div className="room-groups">
              {dashboard.groups.map((group) => (
                <section className="room-group" key={group.name}>
                  <header className="room-group-header">
                    <h2 className="md-typescale-headline-small">{group.name}</h2>
                    <span>{group.rooms.length} room{group.rooms.length === 1 ? "" : "s"}</span>
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
                            <span>Scheduled</span>
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
                          {room.warning && <span className="room-warning">{room.warning}</span>}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
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

              <div className="diagnostic-summary-grid">
                <article className="diagnostic-summary-card">
                  <span>Control loop</span>
                  <strong>{diagnostics.controller.loop_status.replace("_", " ")}</strong>
                  <small>
                    Last successful cycle: {formatDateTime(diagnostics.controller.last_successful_cycle_at)}
                  </small>
                  <small>Expected every {diagnostics.controller.cycle_interval_seconds} seconds</small>
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
                          <dt>Scheduled</dt>
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
                return (
                  <article className={`trv-card ${selection.enabled ? "selected" : ""}`} key={trv.device_id}>
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
                          onChange={(event) =>
                            updateSelection(trv.device_id, {
                              external_temperature_sensor: eventValue(event),
                            })
                          }
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
                        <details>
                          <summary>
                            Technical details · {Object.values(trv.entities).filter(Boolean).length} entities
                          </summary>
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
            <label className="control-toggle primary-control-toggle">
              <MdSwitch
                aria-label="Automatic control"
                selected={control.enabled}
                onChange={(event) => updateControl({ enabled: eventSelected(event) })}
              />
              <span>
                <strong>Automatic control</strong>
                <small>
                  Disabling turns controlled relays off; decisions then remain visible without writes.
                </small>
              </span>
            </label>

            <div className="control-fields">
              <MdOutlinedSelect label="TRV mode" value="heat" disabled>
                <MdSelectOption value="heat" displayText="Heat">Heat</MdSelectOption>
              </MdOutlinedSelect>
              <MdOutlinedSelect label="TRV temperature source" value="internal" disabled>
                <MdSelectOption value="internal" displayText="Internal sensor">
                  Internal sensor
                </MdSelectOption>
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
              <MdFilledButton type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save control settings"}
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
      ) : (
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
      )}
    </main>
  );
}
