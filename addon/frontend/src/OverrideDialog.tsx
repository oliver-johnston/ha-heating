import { useEffect, useState } from "react";
import {
  MdDialog,
  MdFilledButton,
  MdOutlinedButton,
  MdOutlinedTextField,
  MdTextButton,
} from "./material";
import { PresetIcon } from "./PresetIcon";

export type PresetKey = "boost" | "comfort" | "eco" | "frost";
export type TemperatureOverrideScope = "house" | "group" | "room";

export type OverrideTarget =
  | {
      channel: "temperature";
      scopeType: TemperatureOverrideScope;
      scopeId: string | null;
      label: string;
    }
  | {
      channel: "hot_water";
      scopeType: "hot_water";
      scopeId: null;
      label: string;
    };

export type ActiveTemperatureOverride = {
  sequence: number;
  action_id: string;
  scope_type: TemperatureOverrideScope;
  scope_id: string | null;
  override_mode: "preset" | "temperature";
  preset: PresetKey | null;
  temperature: number | null;
  started_at: string;
  expires_at: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  source: string;
};

export type ActiveHotWaterOverride = {
  sequence: number;
  action_id: string;
  on: boolean;
  started_at: string;
  expires_at: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  source: string;
};

export type OverrideActionPayload = {
  channel: "temperature" | "hot_water";
  scope_type: TemperatureOverrideScope | "hot_water";
  scope_id?: string | null;
  operation?: "set" | "clear";
  override_mode?: "preset" | "temperature" | "on_off";
  override_preset?: PresetKey;
  override_temperature?: number;
  on_off?: boolean;
  duration_minutes?: number;
};

type Props = {
  target: OverrideTarget;
  presets: Record<PresetKey, number>;
  active: ActiveTemperatureOverride | ActiveHotWaterOverride | null;
  disabled: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: OverrideActionPayload) => void;
  onClear: (payload: OverrideActionPayload) => void;
};

const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "boost", label: "Boost" },
  { key: "comfort", label: "Comfort" },
  { key: "eco", label: "Eco" },
  { key: "frost", label: "Frost" },
];

const DURATIONS = [
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "240", label: "4 hours" },
] as const;

function eventValue(event: Event) {
  return (event.currentTarget as EventTarget & { value: string }).value;
}

function formatExpiry(value: string | null) {
  if (!value) return "until cancelled";
  return `until ${new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

function activeDescription(
  active: ActiveTemperatureOverride | ActiveHotWaterOverride,
  presets: Record<PresetKey, number>,
) {
  if ("on" in active) return `${active.on ? "On" : "Off"} ${formatExpiry(active.expires_at)}`;
  if (active.override_mode === "preset" && active.preset) {
    return `${active.preset[0].toUpperCase()}${active.preset.slice(1)} · ${presets[active.preset]}°C ${formatExpiry(active.expires_at)}`;
  }
  return `${active.temperature}°C ${formatExpiry(active.expires_at)}`;
}

export function OverrideDialog({
  target,
  presets,
  active,
  disabled,
  saving,
  onClose,
  onSubmit,
  onClear,
}: Props) {
  const [temperatureMode, setTemperatureMode] = useState<"preset" | "temperature">("preset");
  const [preset, setPreset] = useState<PresetKey>("boost");
  const [temperature, setTemperature] = useState(String(presets.boost));
  const [hotWaterOn, setHotWaterOn] = useState(true);
  const [duration, setDuration] = useState("60");

  useEffect(() => {
    setDuration("60");
    if (target.channel === "hot_water") {
      setHotWaterOn(active && "on" in active ? active.on : true);
      return;
    }
    if (active && !("on" in active)) {
      setTemperatureMode(active.override_mode);
      if (active.preset) setPreset(active.preset);
      if (active.temperature !== null) setTemperature(String(active.temperature));
    } else {
      setTemperatureMode("preset");
      setPreset("boost");
      setTemperature(String(presets.boost));
    }
  }, [active, presets.boost, target]);

  const parsedTemperature = Number(temperature);
  const temperatureValid =
    Number.isFinite(parsedTemperature) && parsedTemperature >= 5 && parsedTemperature <= 30;
  const canSubmit = !disabled && !saving && (
    target.channel === "hot_water" || temperatureMode === "preset" || temperatureValid
  );

  function submit() {
    const common = {
      channel: target.channel,
      scope_type: target.scopeType,
      scope_id: target.scopeId,
      duration_minutes: Number(duration),
    } as const;
    if (target.channel === "hot_water") {
      onSubmit({ ...common, override_mode: "on_off", on_off: hotWaterOn });
    } else if (temperatureMode === "preset") {
      onSubmit({ ...common, override_mode: "preset", override_preset: preset });
    } else {
      onSubmit({
        ...common,
        override_mode: "temperature",
        override_temperature: parsedTemperature,
      });
    }
  }

  function clear() {
    onClear({
      channel: target.channel,
      scope_type: target.scopeType,
      scope_id: target.scopeId,
      operation: "clear",
    });
  }

  return (
    <MdDialog
      open
      className="override-dialog"
      aria-label={`Override ${target.label}`}
      onCancel={onClose}
      onClosed={onClose}
    >
      <div slot="content" className="override-dialog-content">
        <button
          type="button"
          className="room-detail-dialog-close"
          aria-label="Close override controls"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.71 2.88 18.3 9.17 12 2.88 5.7l1.41-1.41 6.3 6.3 6.3-6.3 1.41 1.42Z" />
          </svg>
        </button>
        <header className="override-dialog-heading">
          <span>Temporary override</span>
          <h2 className="md-typescale-headline-small">{target.label}</h2>
        </header>

        {active && (
          <div className="active-override-summary">
            <div>
              <span>Active now</span>
              <strong>{activeDescription(active, presets)}</strong>
            </div>
            <MdTextButton type="button" disabled={saving} onClick={clear}>
              Cancel override
            </MdTextButton>
          </div>
        )}

        {target.channel === "temperature" ? (
          <div className="override-value-section">
            <span className="override-field-label">Temperature</span>
            <div className="override-option-grid">
              {PRESETS.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`override-preset-option${
                    temperatureMode === "preset" && preset === item.key ? " selected" : ""
                  }`}
                  onClick={() => {
                    setTemperatureMode("preset");
                    setPreset(item.key);
                  }}
                >
                  <PresetIcon preset={item.key} />
                  <strong>{item.label}</strong>
                  <span>{presets[item.key]}°C</span>
                </button>
              ))}
              <div
                className={`override-custom-option${
                  temperatureMode === "temperature" ? " selected" : ""
                }`}
                onClick={() => setTemperatureMode("temperature")}
              >
                <button
                  type="button"
                  className="override-custom-choice"
                  aria-pressed={temperatureMode === "temperature"}
                  onClick={() => setTemperatureMode("temperature")}
                >
                  <strong>Custom</strong>
                  <span>Set a temperature</span>
                </button>
                <MdOutlinedTextField
                  className="override-custom-temperature"
                  label="Temperature"
                  type="number"
                  min="5"
                  max="30"
                  step="0.5"
                  suffixText="°C"
                  value={temperature}
                  error={temperatureMode === "temperature" && !temperatureValid}
                  errorText="Enter 5°C to 30°C"
                  onFocus={() => setTemperatureMode("temperature")}
                  onInput={(event) => {
                    setTemperatureMode("temperature");
                    setTemperature(eventValue(event));
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="override-value-section">
            <span className="override-field-label">Hot water</span>
            <div className="override-option-grid hot-water-options">
              <button
                type="button"
                className={hotWaterOn ? "selected" : ""}
                onClick={() => setHotWaterOn(true)}
              >
                <strong>On</strong>
                <span>Heat the cylinder</span>
              </button>
              <button
                type="button"
                className={!hotWaterOn ? "selected" : ""}
                onClick={() => setHotWaterOn(false)}
              >
                <strong>Off</strong>
                <span>Pause hot water</span>
              </button>
            </div>
          </div>
        )}

        <div className="override-value-section">
          <span className="override-field-label">Duration</span>
          <div className="override-option-grid duration-options">
            {DURATIONS.map((item) => (
              <button
                type="button"
                key={item.value}
                className={duration === item.value ? "selected" : ""}
                aria-pressed={duration === item.value}
                onClick={() => setDuration(item.value)}
              >
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
        </div>

        {disabled && (
          <p className="override-disabled-message">
            Enable automatic control before starting an override.
          </p>
        )}

        <div className="override-dialog-actions">
          <MdOutlinedButton type="button" disabled={saving} onClick={onClose}>
            Close
          </MdOutlinedButton>
          <MdFilledButton type="button" disabled={!canSubmit} onClick={submit}>
            {saving ? "Saving…" : active ? "Replace override" : "Start override"}
          </MdFilledButton>
        </div>
      </div>
    </MdDialog>
  );
}
