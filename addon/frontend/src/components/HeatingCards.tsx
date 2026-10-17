import type { ReactNode } from "react";
import { MdFilledButton } from "../material";
import type {
  ActiveHotWaterOverride,
  ActiveTemperatureOverride,
  OverrideTarget,
} from "../OverrideDialog";
import { PresetIcon } from "../PresetIcon";
import { ThermostatIcon, WarningIcon } from "./AppChrome";
import {
  ROOM_STATUS_LABELS,
  onOffLabel,
  scheduleValueName,
  type RelayStatus,
} from "../uiHelpers";
import type {
  DashboardData,
  DashboardRoom,
  DiagnosticRoom,
  DiagnosticsData,
  TemperaturePresets,
} from "../types";

export function formatTemperature(value: number | null | undefined, unit: string) {
  if (value == null) return "Unavailable";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}${unit}`;
}

export function formatCompactTemperature(
  value: number | null | undefined,
  target: number,
  threshold: number,
  unit: string,
) {
  if (value == null || threshold <= 0) {
    return formatTemperature(value, unit);
  }
  if (value < target && value >= target - threshold) {
    return formatTemperature(target, unit);
  }
  const nearestBand = Math.round((value - target) / threshold);
  return formatTemperature(target + nearestBand * threshold, unit);
}

export function formatDateTime(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = units[0];
  for (const candidate of units.slice(1)) {
    if (size < 1024) break;
    size /= 1024;
    unit = candidate;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(size)} ${unit}`;
}

export function formatAge(seconds: number | null | undefined) {
  if (seconds == null) return "time unavailable";
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} seconds ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  return `${Math.round(seconds / 3600)} hours ago`;
}

export function formatNextScheduleValue(
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

export function formatNextHotWaterChange(controller: DashboardData["controller"]) {
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

export function roomHasDeviceIssue(room: DashboardRoom) {
  return Boolean(room.warning) || room.status === "stale" || room.status === "unavailable";
}

export function roomDeviceIssueMessage(room: DashboardRoom) {
  if (room.warning) return room.warning;
  if (room.status === "stale") return "The TRV has not reported recently.";
  if (room.status === "unavailable") return "The TRV or room temperature is unavailable.";
  return null;
}

export function TechnicalPill({
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

export function ControlSettingRow({
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

export function OverrideClockGraphic({ showPlus = false }: { showPlus?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" focusable="false" aria-hidden="true">
      <path d="M11.99 2A10 10 0 1 0 22 12 10 10 0 0 0 11.99 2Zm.01 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm.5-13H11v6l5.2 3.2.8-1.28-4.5-2.67V7Z" />
      {showPlus && <path d="M19 2v3h3v2h-3v3h-2V7h-3V5h3V2h2Z" />}
    </svg>
  );
}

export function TemporaryOverrideIcon({ active }: { active: boolean }) {
  return (
    <span slot="icon" className="override-button-icon" aria-hidden="true">
      <OverrideClockGraphic showPlus={!active} />
    </span>
  );
}

export function CompactRoomPresetIcon({ room }: { room: DashboardRoom }) {
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

export function CompactRoomIcons({ room }: { room: DashboardRoom }) {
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

export function OverrideActionButton({
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

export function DetailCard({
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

export function RoomDetails({
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
  const scheduledLabel = room.control_source === "preheat"
    ? "Preheating"
    : room.control_source === "boost"
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

export function DetailedRoomCard({
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

export function CompactRelayCard({
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

export function RelayDetails({
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

export function relayState(value: boolean | null, configured: boolean) {
  if (!configured) return "Not configured";
  if (value === null) return "Unavailable";
  return value ? "On" : "Off";
}

export function diagnosticStatusLabel(status: DiagnosticsData["overall_status"]) {
  return {
    monitoring: "Monitoring only",
    running: "Running normally",
    warning: "Needs attention",
    error: "Control error",
  }[status];
}

export function formatOverrideExpiry(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

export function activeOverrideFor(
  dashboard: DashboardData,
  target: OverrideTarget,
): ActiveTemperatureOverride | ActiveHotWaterOverride | null {
  if (target.channel === "hot_water") return dashboard.overrides.hot_water_override ?? null;
  return (dashboard.overrides.temperature_overrides ?? []).find(
    (override) =>
      override.scope_type === target.scopeType && override.scope_id === target.scopeId,
  ) ?? null;
}

export function temperatureOverrideFor(
  dashboard: DashboardData,
  scopeType: "house" | "group" | "room",
  scopeId: string | null,
) {
  return (dashboard.overrides.temperature_overrides ?? []).find(
    (override) => override.scope_type === scopeType && override.scope_id === scopeId,
  ) ?? null;
}

export function overrideSummary(
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

export function overrideScopeLabel(
  override: ActiveTemperatureOverride | ActiveHotWaterOverride,
  rooms: DiagnosticRoom[],
) {
  if ("on" in override) return "Hot water";
  if (override.scope_type === "house") return "Whole house";
  if (override.scope_type === "group") return override.scope_id ?? "Unknown group";
  return rooms.find((room) => room.device_id === override.scope_id)?.name ?? override.scope_id ?? "Unknown room";
}

export function overrideActorLabel(override: ActiveTemperatureOverride | ActiveHotWaterOverride) {
  const actor = override.actor_name ?? override.actor_user_id;
  return actor ? `${actor} via ${override.source}` : override.source;
}

export function appliedOverrideForRoom(
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
