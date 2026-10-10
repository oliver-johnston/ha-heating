import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  MdCheckbox,
  MdFilledButton,
  MdOutlinedButton,
  MdOutlinedSelect,
  MdOutlinedTextField,
  MdPrimaryTab,
  MdSelectOption,
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

type SetupProgress = {
  devices: boolean;
  boiler: boolean;
  presets: boolean;
  schedules: boolean;
};

type SavedConfig = {
  boiler_switch: string | null;
  hot_water_switch: string | null;
  minimum_heat_requests: number;
  trvs: SavedTRV[];
  presets: TemperaturePresets;
  setup: SetupProgress;
  schedules: RoomSchedule[];
  updated_at: string;
};

type DashboardRoom = {
  device_id: string;
  name: string;
  trv_name: string;
  climate_entity: string;
  current_temperature_entity: string;
  current_temperature: number | null;
  target_temperature: number | null;
  unit: string;
  available: boolean;
};

type DashboardData = {
  updated_at: string;
  groups: Array<{ name: string; rooms: DashboardRoom[] }>;
};

type Selection = {
  enabled: boolean;
  room_group: string;
  external_temperature_sensor: string;
};

type PresetValues = Record<PresetKey, string>;
type Screen = "dashboard" | "devices" | "boiler" | "presets" | "schedules";

const DEFAULT_PRESETS: PresetValues = {
  boost: "23",
  comfort: "21",
  eco: "16",
  frost: "5",
};

const PRESET_DEFINITIONS: Array<{ key: PresetKey; name: string; description: string }> = [
  { key: "boost", name: "Boost", description: "Quickly warm a room above its normal target." },
  { key: "comfort", name: "Comfort", description: "The normal temperature for an occupied room." },
  { key: "eco", name: "Eco", description: "Save energy while keeping the room gently heated." },
  { key: "frost", name: "Frost", description: "Protect the room and pipework from freezing." },
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
const SETTINGS_SCREENS: Array<Exclude<Screen, "dashboard">> = [
  "devices",
  "boiler",
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

function friendlyRole(role: string) {
  return role.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function presetName(preset: PresetKey) {
  return preset.replace(/^./, (letter) => letter.toUpperCase());
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

function eventValue(event: Event) {
  return (event.currentTarget as EventTarget & { value: string }).value;
}

function eventChecked(event: Event) {
  return (event.currentTarget as EventTarget & { checked: boolean }).checked;
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

function validateSchedules(schedules: RoomSchedule[]) {
  for (const schedule of schedules) {
    for (const [index, period] of schedule.periods.entries()) {
      if (period.days.length === 0) {
        return `${schedule.room_group}, period ${index + 1}: choose at least one day.`;
      }
      const start = timeMinutes(period.start);
      const end = timeMinutes(period.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        return `${schedule.room_group}, period ${index + 1}: the end time must be after the start time.`;
      }
    }
    for (const day of WEEKDAYS) {
      const periods = schedule.periods
        .filter((period) => period.days.includes(day.key))
        .map((period) => ({ start: timeMinutes(period.start), end: timeMinutes(period.end) }))
        .sort((a, b) => a.start - b.start);
      if (periods.some((period, index) => index > 0 && period.start < periods[index - 1].end)) {
        return `${schedule.room_group}: periods overlap on ${day.name}.`;
      }
    }
  }
  return "";
}

function formatTemperature(value: number | null, unit: string) {
  if (value === null) return "Unavailable";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}${unit}`;
}

export default function App() {
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [saved, setSaved] = useState<SavedConfig | null>(null);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [boilerSwitch, setBoilerSwitch] = useState("");
  const [hotWaterSwitch, setHotWaterSwitch] = useState("");
  const [minimumHeatRequests, setMinimumHeatRequests] = useState("1");
  const [presets, setPresets] = useState<PresetValues>(DEFAULT_PRESETS);
  const [schedules, setSchedules] = useState<RoomSchedule[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [selectedRoomGroup, setSelectedRoomGroup] = useState("");
  const [screen, setScreen] = useState<Screen>("devices");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [presetError, setPresetError] = useState("");
  const [scheduleError, setScheduleError] = useState("");

  async function load(openSettings = false) {
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
          ? "devices"
          : existing && !existing.setup.boiler
            ? "boiler"
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
    screen === "presets"
      ? presetError || error
      : screen === "schedules"
        ? scheduleError || error
        : error;
  const selectedSchedule = schedules.find(
    (schedule) => schedule.room_group === selectedRoomGroup,
  );

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
    }
  }

  function updatePreset(key: PresetKey, value: string) {
    setPresets((current) => ({ ...current, [key]: value }));
    setNotice("");
    setPresetError("");
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

  function updateRoomSchedule(roomGroup: string, update: (schedule: RoomSchedule) => RoomSchedule) {
    setSchedules((current) =>
      current.map((schedule) =>
        schedule.room_group === roomGroup ? update(schedule) : schedule,
      ),
    );
    setNotice("");
    setScheduleError("");
  }

  function addPeriod() {
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

  function updatePeriod(index: number, patch: Partial<SchedulePeriod>) {
    if (!selectedSchedule) return;
    updateRoomSchedule(selectedSchedule.room_group, (schedule) => ({
      ...schedule,
      periods: schedule.periods.map((period, periodIndex) =>
        periodIndex === index ? { ...period, ...patch } : period,
      ),
    }));
  }

  function removePeriod(index: number) {
    if (!selectedSchedule) return;
    updateRoomSchedule(selectedSchedule.room_group, (schedule) => ({
      ...schedule,
      periods: schedule.periods.filter((_, periodIndex) => periodIndex !== index),
    }));
  }

  function togglePeriodDay(index: number, day: Weekday) {
    if (!selectedSchedule) return;
    const period = selectedSchedule.periods[index];
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
      setSelectedRoomGroup((current) =>
        nextSchedules.some((schedule) => schedule.room_group === current)
          ? current
          : nextSchedules[0]?.room_group ?? "",
      );
      setNotice("Configuration saved and verified against Home Assistant.");
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
        setScreen("presets");
      } else {
        setNotice("Boiler settings saved.");
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
      setSaved(body.config as SavedConfig);
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
    const validationError = validateSchedules(schedules);
    if (validationError) {
      setScheduleError(validationError);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(api("schedules"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedules }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save schedules");
      setSaved(body.config as SavedConfig);
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
          activeTabIndex={screen === "dashboard" ? 0 : 1}
          onChange={changeAppTab}
          aria-label="Home Heating"
        >
          <MdPrimaryTab hasIcon active={screen === "dashboard"}>
            <HomeIcon />
            Dashboard
          </MdPrimaryTab>
          <MdPrimaryTab hasIcon active={screen !== "dashboard"}>
            <SettingsIcon />
            Settings
          </MdPrimaryTab>
        </MdTabs>
      )}
      {screen === "dashboard" && (
        <div className="page-actions">
          <div className="header-actions">
            <div className="dashboard-actions">
              <MdOutlinedButton
                type="button"
                disabled={dashboardLoading}
                onClick={() => void loadDashboard()}
              >
                {dashboardLoading ? "Refreshing…" : "Refresh"}
              </MdOutlinedButton>
            </div>
          </div>
        </div>
      )}

      {discovery && screen !== "dashboard" &&
        (setupComplete ? (
          <MdTabs
            className={`config-tabs ${screen === "devices" ? "with-actions" : ""}`}
            activeTabIndex={SETTINGS_SCREENS.indexOf(screen)}
            onChange={changeSettingsTab}
            aria-label="Heating configuration"
          >
            <MdPrimaryTab active={screen === "devices"}>Devices</MdPrimaryTab>
            <MdPrimaryTab active={screen === "boiler"}>Boiler</MdPrimaryTab>
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
                  : screen === "presets" || screen === "schedules" || saved?.setup.boiler
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
                screen === "presets"
                  ? "active"
                  : screen === "schedules" || saved?.setup.presets
                    ? "complete"
                    : "pending"
              }
            >
              <span>3</span>
              Presets
            </li>
            <li className={screen === "schedules" ? "active" : "pending"}>
              <span>4</span>
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
            <div className="room-groups">
              {dashboard.groups.map((group) => (
                <section className="room-group" key={group.name}>
                  <header className="room-group-header">
                    <h2 className="md-typescale-headline-small">{group.name}</h2>
                    <span>{group.rooms.length} room{group.rooms.length === 1 ? "" : "s"}</span>
                  </header>
                  <div className="room-grid">
                    {group.rooms.map((room) => (
                      <article className="room-card" key={room.device_id}>
                        <div className="room-card-title">
                          <div>
                            <h3 className="md-typescale-title-large">{room.name}</h3>
                            {room.trv_name !== room.name && <span>{room.trv_name}</span>}
                          </div>
                          {!room.available && <span className="unavailable-badge">TRV unavailable</span>}
                        </div>
                        <div className="temperature-readings">
                          <div className="current-reading">
                            <span>Current</span>
                            <strong>{formatTemperature(room.current_temperature, room.unit)}</strong>
                          </div>
                          <div className="target-reading">
                            <span>Set to</span>
                            <strong>{formatTemperature(room.target_temperature, room.unit)}</strong>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2 className="md-typescale-headline-small">Room temperatures are unavailable</h2>
              <MdFilledButton type="button" onClick={() => void loadDashboard()}>Try again</MdFilledButton>
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
            <div>
              <strong>{selectedCount} radiator valve{selectedCount === 1 ? "" : "s"} selected</strong>
              <span>This onboarding release will not operate any heating devices.</span>
            </div>
            <div className="save-actions">
              {saved && (
                <MdTextButton type="button" onClick={() => showScreen("boiler")}>
                  Set up boiler
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
            <div>
              <strong>Optional boiler control</strong>
              <span>You can leave both switches empty and configure them later.</span>
            </div>
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
              {saved?.setup.boiler && (
                <MdTextButton type="button" onClick={() => showScreen("presets")}>
                  Set up presets
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
            <div>
              <strong>Four global presets</strong>
              <span>Schedules use these names, so you can change temperatures in one place.</span>
            </div>
            <div className="save-actions">
              <MdTextButton type="button" onClick={() => showScreen("boiler")}>Back</MdTextButton>
              {saved?.setup.presets && (
                <MdTextButton type="button" onClick={() => showScreen("schedules")}>
                  Set up schedules
                </MdTextButton>
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
      ) : (
        <form onSubmit={saveSchedules}>
          <section className="section-heading schedule-heading">
            <div>
              <h2 className="md-typescale-headline-small">Weekly schedules</h2>
              <p>Set timed overrides for each room group. The default preset fills every gap.</p>
            </div>
            <MdOutlinedSelect
              label="Room group"
              value={selectedRoomGroup}
              onChange={(event) => setSelectedRoomGroup(eventValue(event))}
            >
              {schedules.map((schedule) => (
                <MdSelectOption value={schedule.room_group} key={schedule.room_group}>
                  {schedule.room_group}
                </MdSelectOption>
              ))}
            </MdOutlinedSelect>
          </section>

          {selectedSchedule && (
            <>
              <section className="schedule-overview" aria-label={`${selectedSchedule.room_group} weekly schedule`}>
                <div className="schedule-overview-header">
                  <div>
                    <h3 className="md-typescale-title-large">{selectedSchedule.room_group}</h3>
                    <p>At a glance</p>
                  </div>
                  <MdOutlinedSelect
                    label="Default preset"
                    value={selectedSchedule.default_preset}
                    onChange={(event) =>
                      updateRoomSchedule(selectedSchedule.room_group, (schedule) => ({
                        ...schedule,
                        default_preset: eventValue(event) as PresetKey,
                      }))
                    }
                  >
                    {PRESET_DEFINITIONS.map((preset) => (
                      <MdSelectOption value={preset.key} key={preset.key}>{preset.name}</MdSelectOption>
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
                        className={`timeline-track preset-${selectedSchedule.default_preset}`}
                        aria-label={`${day.name}, default ${presetName(selectedSchedule.default_preset)}`}
                      >
                        {selectedSchedule.periods
                          .filter((period) => period.days.includes(day.key))
                          .map((period, index) => {
                            const start = timeMinutes(period.start);
                            const end = timeMinutes(period.end);
                            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
                            const title = `${presetName(period.preset)} · ${period.start}–${period.end}`;
                            return (
                              <span
                                className={`timeline-period preset-${period.preset}`}
                                style={{ left: `${(start / 1440) * 100}%`, width: `${((end - start) / 1440) * 100}%` }}
                                title={title}
                                aria-label={title}
                                key={`${period.start}-${period.end}-${index}`}
                              >
                                {end - start >= 180 ? presetName(period.preset) : ""}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="schedule-legend" aria-label="Preset colours">
                  {PRESET_DEFINITIONS.map((preset) => (
                    <span key={preset.key}><i className={`preset-${preset.key}`} />{preset.name}</span>
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

                {selectedSchedule.periods.length === 0 ? (
                  <div className="empty-periods">
                    <strong>No timed periods yet</strong>
                    <span>{presetName(selectedSchedule.default_preset)} will be used all week.</span>
                  </div>
                ) : (
                  <div className="period-list">
                    {selectedSchedule.periods.map((period, index) => (
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
                            label="Preset"
                            value={period.preset}
                            onChange={(event) => updatePeriod(index, { preset: eventValue(event) as PresetKey })}
                          >
                            {PRESET_DEFINITIONS.map((preset) => (
                              <MdSelectOption value={preset.key} key={preset.key}>{preset.name}</MdSelectOption>
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
            <div>
              <strong>{schedules.length} room group{schedules.length === 1 ? "" : "s"}</strong>
              <span>Every room group has a complete seven-day schedule.</span>
            </div>
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
