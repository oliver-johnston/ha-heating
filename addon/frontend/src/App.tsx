import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  MdFilledButton,
  MdOutlinedButton,
  MdPrimaryTab,
  MdTabs,
  MdTextButton,
} from "./material";
import {
  type OverrideActionPayload,
  type OverrideTarget,
} from "./OverrideDialog";
import heatStewardIcon from "./assets/heat-steward-icon.svg";
import { apiUrl as api } from "./api/client";
import { useDashboard } from "./hooks/useDashboard";
import { useDiagnostics } from "./hooks/useDiagnostics";
import { DashboardPage } from "./pages/DashboardPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { RadiatorsSettingsPage } from "./pages/settings/RadiatorsSettingsPage";
import { BoilerSettingsPage } from "./pages/settings/BoilerSettingsPage";
import { ControlSettingsPage } from "./pages/settings/ControlSettingsPage";
import { PreheatingSettingsPage } from "./pages/settings/PreheatingSettingsPage";
import { PresetsSettingsPage } from "./pages/settings/PresetsSettingsPage";
import { SchedulesSettingsPage } from "./pages/settings/SchedulesSettingsPage";
import { NotificationsSettingsPage } from "./pages/settings/NotificationsSettingsPage";
import { ThemeSettingsPage } from "./pages/settings/ThemeSettingsPage";

import type {
  ControlValues,
  Discovery,
  HotWaterSchedule,
  HotWaterState,
  NotificationValues,
  PreflightResult,
  PresetKey,
  PresetValues,
  RoomSchedule,
  SavedConfig,
  Screen,
  Selection,
  SettingsScreen,
  TemperaturePresets,
  Weekday,
} from "./types";

import {
  CONFIGURED_WEBHOOK_VALUE,
  DEFAULT_CONTROL,
  DEFAULT_HOT_WATER_SCHEDULE,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_PRESETS,
  HOT_WATER_DEFINITIONS,
  HOT_WATER_SCHEDULE_KEY,
  PRESET_DEFINITIONS,
  WEEKDAYS,
  controlPayload,
  controlValues,
  notificationValues,
  selectionValues,
  validateControlValues,
} from "./configForms";

const SETTINGS_SCREENS: SettingsScreen[] = [
  "devices",
  "boiler",
  "control",
  "preheating",
  "presets",
  "schedules",
  "notifications",
  "theme",
];

const PREDICTIVE_BANNER_DISMISSED_KEY = "heat-steward-predictive-banner-dismissed-v1";

function predictiveBannerWasDismissed(): boolean {
  try {
    return window.localStorage.getItem(PREDICTIVE_BANNER_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

import {
  DiagnosticsIcon,
  HomeIcon,
  SettingsIcon,
  ToolbarDropdown,
  WarningIcon,
} from "./components/AppChrome";
import {
  scheduleValueName,
  schedulesForConfig,
  selectionIsConfigured,
  validateSchedules,
} from "./uiHelpers";
import { activeOverrideFor } from "./components/HeatingCards";
import { applyTheme, storedTheme, type ThemeId } from "./theme";
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
  const [detailedDashboard, setDetailedDashboard] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(storedTheme);
  const [selectedDashboardRoomId, setSelectedDashboardRoomId] = useState<string | null>(null);
  const [selectedDashboardRelay, setSelectedDashboardRelay] = useState<"heating" | "hot_water" | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(null);
  const [selectedRoomGroup, setSelectedRoomGroup] = useState("");
  const [screen, setScreen] = useState<Screen>("devices");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  const [predictiveBannerDismissed, setPredictiveBannerDismissed] = useState(
    predictiveBannerWasDismissed,
  );
  const {
    dashboard,
    loading: dashboardLoading,
    refresh: loadDashboard,
  } = useDashboard(screen === "dashboard", setError);
  const {
    diagnostics,
    loading: diagnosticsLoading,
    refresh: loadDiagnostics,
  } = useDiagnostics(screen === "diagnostics", setDiagnosticsError);
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
        predictive_models: discoveryBody.predictive_models ?? {},
        predictive_models_error: discoveryBody.predictive_models_error ?? null,
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
    applyTheme(theme);
  }, [theme]);


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

  function dismissPredictiveBanner() {
    setPredictiveBannerDismissed(true);
    try {
      window.localStorage.setItem(PREDICTIVE_BANNER_DISMISSED_KEY, "true");
    } catch {
      // The in-memory dismissal still applies when browser storage is unavailable.
    }
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
    } else if (settingsScreen === "preheating") {
      setControl(controlValues(saved?.control));
      if (discovery) setSelections(selectionValues(discovery, saved));
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

  async function persistRadiators(
    nextSelections: Record<string, Selection>,
    successMessage: string,
    advanceOnboarding: boolean,
    preserveControl = false,
  ) {
    if (!discovery) return null;
    setSaving(true);
    setError("");
    setNotice("");
    const trvs = discovery.trvs
      .filter((trv) => nextSelections[trv.device_id]?.enabled)
      .map((trv) => ({
        device_id: trv.device_id,
        room_group: nextSelections[trv.device_id].room_group.trim(),
        external_temperature_sensor:
          nextSelections[trv.device_id].external_temperature_sensor || null,
        external_temperature_last_seen:
          nextSelections[trv.device_id].external_temperature_freshness === "last_seen"
            ? nextSelections[trv.device_id].external_temperature_last_seen || null
            : null,
        external_temperature_freshness:
          nextSelections[trv.device_id].external_temperature_freshness,
        external_sensor_stale_seconds: nextSelections[trv.device_id].external_sensor_stale_minutes
          ? Number(nextSelections[trv.device_id].external_sensor_stale_minutes) * 60
          : null,
        trv_last_seen:
          nextSelections[trv.device_id].trv_freshness === "last_seen"
            ? nextSelections[trv.device_id].trv_last_seen || null
            : null,
        trv_freshness: nextSelections[trv.device_id].trv_freshness,
        predictive_heating_enabled:
          nextSelections[trv.device_id].predictive_heating_enabled,
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
      setSelections(selectionValues(discovery, config));
      if (!preserveControl) setControl(controlValues(config.control));
      setSchedules(nextSchedules);
      setHotWaterSchedule(config.hot_water_schedule ?? DEFAULT_HOT_WATER_SCHEDULE);
      setSelectedRoomGroup((current) =>
        nextSchedules.some((schedule) => schedule.room_group === current)
          ? current
          : nextSchedules[0]?.room_group ?? "",
      );
      setNotice(successMessage);
      setExpandedDevices(new Set());
      if (advanceOnboarding && !setupComplete) setScreen("boiler");
      return config;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await persistRadiators(
      selections,
      "Configuration saved and verified against Home Assistant.",
      true,
    );
  }

  async function persistPreheatingControl(
    nextControl: ControlValues,
    successMessage: string,
  ) {
    const validationError = validateControlValues(nextControl);
    if (validationError) {
      setError(validationError);
      setNotice("");
      return null;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api("control"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(controlPayload(nextControl)),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save preheating settings");
      const config = body.config as SavedConfig;
      setSaved(config);
      setControl(controlValues(config.control));
      setNotice(successMessage);
      return config;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function savePreheating(event: FormEvent) {
    event.preventDefault();
    const savedRooms = await persistRadiators(
      selections,
      "Room selections saved.",
      false,
      true,
    );
    if (!savedRooms) return;
    await persistPreheatingControl(control, "Preheating settings saved.");
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
            {(screen === "dashboard" || screen === "diagnostics") && (
              <>
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
              </>
            )}
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
        <DashboardPage
          loading={dashboardLoading}
          dashboard={dashboard}
          saved={saved}
          detailedDashboard={detailedDashboard}
          dashboardPresets={dashboardPresets}
          overrideSaving={overrideSaving}
          selectedDashboardRoom={selectedDashboardRoom}
          setSelectedDashboardRoomId={setSelectedDashboardRoomId}
          selectedDashboardRelay={selectedDashboardRelay}
          setSelectedDashboardRelay={setSelectedDashboardRelay}
          overrideTarget={overrideTarget}
          setOverrideTarget={setOverrideTarget}
          activeOverride={activeOverride}
          onOpenControlSettings={() => void load(true, "control")}
          onOpenPreheatingSettings={() => void load(true, "preheating")}
          predictiveBannerDismissed={predictiveBannerDismissed}
          onDismissPredictiveBanner={dismissPredictiveBanner}
          onReload={() => void loadDashboard()}
          saveOverride={saveOverride}
          clearOverride={clearOverride}
        />
      ) : screen === "diagnostics" ? (
        <DiagnosticsPage
          loading={diagnosticsLoading}
          diagnostics={diagnostics}
          dashboardPresets={dashboardPresets}
          acknowledgingFault={acknowledgingFault}
          onReload={() => void loadDiagnostics()}
          onAcknowledgeFault={() => void acknowledgeFault()}
        />
      ) : !discovery ? (
        <section className="empty-state">
          <h2 className="md-typescale-headline-small">Home Assistant is unavailable</h2>
          <MdFilledButton type="button" onClick={() => void load()}>Try again</MdFilledButton>
        </section>
      ) : screen === "devices" ? (
        <RadiatorsSettingsPage
          discovery={discovery}
          selections={selections}
          selectedCount={selectedCount}
          expandedDevices={expandedDevices}
          setExpandedDevices={setExpandedDevices}
          updateSelection={updateSelection}
          control={control}
          setupComplete={setupComplete}
          saving={saving}
          notice={notice}
          visibleError={visibleError}
          onSubmit={save}
          onRescan={() => void load(true, "devices")}
          onRevert={() => revertSettings("devices")}
        />
      ) : screen === "boiler" ? (
        <BoilerSettingsPage
          discovery={discovery}
          boilerSwitch={boilerSwitch}
          setBoilerSwitch={setBoilerSwitch}
          hotWaterSwitch={hotWaterSwitch}
          setHotWaterSwitch={setHotWaterSwitch}
          minimumHeatRequests={minimumHeatRequests}
          setMinimumHeatRequests={setMinimumHeatRequests}
          minimumHeatRequestsValid={minimumHeatRequestsValid}
          maximumHeatRequests={maximumHeatRequests}
          setupComplete={setupComplete}
          boilerSetupComplete={saved?.setup.boiler ?? false}
          saving={saving}
          notice={notice}
          visibleError={visibleError}
          onSubmit={saveBoiler}
          onSkip={() => void persistBoilerSettings(true)}
          onBack={() => showScreen("devices")}
          onRevert={() => revertSettings("boiler")}
          onDirty={() => setNotice("")}
        />
      ) : screen === "control" ? (
        <ControlSettingsPage
          control={control}
          updateControl={updateControl}
          toggleAutomaticControl={toggleAutomaticControl}
          preflight={preflight}
          preflightLoading={preflightLoading}
          saved={saved}
          setupComplete={setupComplete}
          saving={saving}
          notice={notice}
          visibleError={visibleError}
          onSubmit={saveControl}
          onBack={() => showScreen("boiler")}
          onRevert={() => revertSettings("control")}
          onOpenDiagnostics={() => {
            showScreen("diagnostics");
            void loadDiagnostics();
          }}
        />
      ) : screen === "preheating" ? (
        <PreheatingSettingsPage
          discovery={discovery}
          selections={selections}
          updateSelection={updateSelection}
          control={control}
          updateControl={updateControl}
          saving={saving}
          notice={notice}
          visibleError={visibleError}
          onSubmit={savePreheating}
          onRevert={() => revertSettings("preheating")}
        />
      ) : screen === "presets" ? (
        <PresetsSettingsPage
          presets={presets}
          updatePreset={updatePreset}
          setupComplete={setupComplete}
          saving={saving}
          notice={notice}
          visibleError={visibleError}
          onSubmit={savePresets}
          onBack={() => showScreen("control")}
          onRevert={() => revertSettings("presets")}
        />
      ) : screen === "schedules" ? (
        <SchedulesSettingsPage
          schedules={schedules}
          selectedRoomGroup={selectedRoomGroup}
          setSelectedRoomGroup={setSelectedRoomGroup}
          selectedSchedule={selectedSchedule}
          editingHotWater={editingHotWater}
          activeScheduleName={activeScheduleName}
          activeDefaultValue={activeDefaultValue}
          activePeriods={activePeriods}
          activeDefinitions={activeDefinitions}
          hotWaterConfigured={Boolean(saved?.hot_water_switch)}
          setupComplete={setupComplete}
          saving={saving}
          notice={notice}
          visibleError={visibleError}
          onSubmit={saveSchedules}
          updateDefaultScheduleValue={updateDefaultScheduleValue}
          addPeriod={addPeriod}
          removePeriod={removePeriod}
          togglePeriodDay={togglePeriodDay}
          updatePeriod={updatePeriod}
          onBack={() => showScreen("boiler")}
          onRevert={() => revertSettings("schedules")}
        />
      ) : screen === "notifications" ? (
        <NotificationsSettingsPage
          notifications={notifications}
          setNotifications={setNotifications}
          discordWebhook={discordWebhook}
          setDiscordWebhook={setDiscordWebhook}
          webhookConfigured={saved?.notifications?.discord_webhook_configured ?? false}
          discordWebhookChanged={discordWebhookChanged}
          notificationSettingsValid={notificationSettingsValid}
          setupComplete={setupComplete}
          saving={saving}
          testingNotifications={testingNotifications}
          notice={notice}
          visibleError={visibleError}
          onSubmit={saveNotifications}
          onRemoveWebhook={() => void removeDiscordWebhook()}
          onTestNotifications={() => void testNotifications()}
          onRevert={() => revertSettings("notifications")}
          onDirty={() => setNotice("")}
        />
      ) : (
        <ThemeSettingsPage theme={theme} onChange={setTheme} />
      )}
    </main>
  );
}
