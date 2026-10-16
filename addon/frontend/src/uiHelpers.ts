import type {
  DashboardRoom,
  Discovery,
  EntityOption,
  HotWaterSchedule,
  RoomSchedule,
  SavedConfig,
  Selection,
  Weekday,
} from "./types";
import { WEEKDAYS } from "./configForms";

function relativeAge(seconds: number) {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} seconds ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  return `${Math.round(seconds / 3600)} hours ago`;
}

export function friendlyRole(role: string) {
  return role.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function scheduleValueName(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replace(/^./, (letter) => letter.toUpperCase());
}

export const ROOM_STATUS_LABELS: Record<DashboardRoom["status"], string> = {
  heating: "Heating",
  waiting: "Waiting for boiler",
  opening: "Heat requested",
  closing: "Closing",
  within_range: "Within range",
  idle: "Satisfied",
  stale: "Not recently seen",
  unavailable: "Unavailable",
};

export type RelayStatus = "on" | "waiting" | "off" | "unavailable";

export const RELAY_STATUS_LABELS: Record<RelayStatus, string> = {
  on: "On",
  waiting: "Waiting to turn on",
  off: "Off",
  unavailable: "Unavailable",
};

export function relayStatus(actual: boolean | null, requested: boolean | null): RelayStatus {
  if (actual === null) return "unavailable";
  if (actual) return "on";
  if (requested) return "waiting";
  return "off";
}

export function onOffLabel(value: boolean | null) {
  if (value === null) return "Unavailable";
  return value ? "On" : "Off";
}

export function optionLabel(option: EntityOption) {
  const context = option.area_name ?? option.device_name;
  const nameAlreadyHasContext =
    context && option.name.toLocaleLowerCase().includes(context.toLocaleLowerCase());
  const prefix = context && !nameAlreadyHasContext ? `${context} · ` : "";
  const state = option.state && option.state !== "unknown" ? ` · ${option.state}${option.unit ?? ""}` : "";
  return `${prefix}${option.name}${state}`;
}

export function sensorOptionHeadline(option: EntityOption) {
  const device = option.device_name ?? option.area_name;
  const state = option.state && option.state !== "unknown" ? `${option.state}${option.unit ?? ""}` : null;
  return [device, option.entity_name, state].filter(Boolean).join(" · ");
}

export function healthOptionHeadline(option: EntityOption) {
  const device = option.device_name ?? option.area_name;
  const timestamp = option.state ? new Date(option.state) : null;
  const state = timestamp && Number.isFinite(timestamp.getTime())
    ? relativeAge(Math.max(0, (Date.now() - timestamp.getTime()) / 1000))
    : option.state;
  return [device, option.entity_name, state].filter(Boolean).join(" · ");
}

export function selectionIsConfigured(selection: Selection, discovery: Discovery) {
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

export function eventValue(event: Event) {
  return (event.currentTarget as EventTarget & { value: string }).value;
}

export function eventChecked(event: Event) {
  return (event.currentTarget as EventTarget & { checked: boolean }).checked;
}

export function eventSelected(event: Event) {
  return (event.currentTarget as EventTarget & { selected: boolean }).selected;
}

export function roomGroups(config: SavedConfig | null) {
  return [...new Set(config?.trvs.map((trv) => trv.room_group) ?? [])].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function schedulesForConfig(config: SavedConfig | null) {
  const existing = new Map(config?.schedules?.map((schedule) => [schedule.room_group, schedule]));
  return roomGroups(config).map(
    (room_group): RoomSchedule =>
      existing.get(room_group) ?? { room_group, default_preset: "eco", periods: [] },
  );
}

export function timeMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function validatePeriods(
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

export function validateSchedules(schedules: RoomSchedule[], hotWaterSchedule: HotWaterSchedule) {
  return validatePeriods([
    ...schedules.map((schedule) => ({ name: schedule.room_group, periods: schedule.periods })),
    { name: "Hot water", periods: hotWaterSchedule.periods },
  ]);
}
