import type { FormEventHandler } from "react";
import {
  MdFilledButton,
  MdOutlinedSelect,
  MdOutlinedTextField,
  MdSelectOption,
  MdSwitch,
  MdTextButton,
} from "../../material";
import { ControlSettingRow } from "../../components/HeatingCards";
import { WarningIcon } from "../../components/AppChrome";
import { ADDON_CONTROL_FIELDS, PRESET_DEFINITIONS } from "../../configForms";
import { eventSelected, eventValue } from "../../uiHelpers";
import type { ControlValues, PreflightResult, PresetKey, SavedConfig } from "../../types";

type Props = {
  control: ControlValues;
  updateControl: (patch: Partial<ControlValues>) => void;
  toggleAutomaticControl: (enabled: boolean) => void;
  preflight: PreflightResult | null;
  preflightLoading: boolean;
  saved: SavedConfig | null;
  setupComplete: boolean;
  saving: boolean;
  notice: string;
  visibleError: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onBack: () => void;
  onRevert: () => void;
  onOpenDiagnostics: () => void;
};

export function ControlSettingsPage({
  control,
  updateControl,
  toggleAutomaticControl,
  preflight,
  preflightLoading,
  saved,
  setupComplete,
  saving,
  notice,
  visibleError,
  onSubmit: saveControl,
  onBack,
  onRevert,
  onOpenDiagnostics,
}: Props) {
  return (
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
                <MdTextButton type="button" onClick={onOpenDiagnostics}>
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
                  onClick={() => onRevert()}
                >
                  Revert
                </MdTextButton>
              ) : (
                <MdTextButton type="button" onClick={() => onBack()}>Back</MdTextButton>
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
  );
}
