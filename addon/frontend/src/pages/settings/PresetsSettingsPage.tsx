import type { FormEventHandler } from "react";
import { MdFilledButton, MdOutlinedTextField, MdTextButton } from "../../material";
import { ControlSettingRow } from "../../components/HeatingCards";
import { PRESET_DEFINITIONS } from "../../configForms";
import { eventValue } from "../../uiHelpers";
import type { PresetKey, PresetValues } from "../../types";

type Props = {
  presets: PresetValues;
  updatePreset: (key: PresetKey, value: string) => void;
  setupComplete: boolean;
  saving: boolean;
  notice: string;
  visibleError: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onBack: () => void;
  onRevert: () => void;
};

export function PresetsSettingsPage({
  presets,
  updatePreset,
  setupComplete,
  saving,
  notice,
  visibleError,
  onSubmit: savePresets,
  onBack,
  onRevert,
}: Props) {
  return (
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
                  onClick={() => onRevert()}
                >
                  Revert
                </MdTextButton>
              ) : (
                <MdTextButton type="button" onClick={() => onBack()}>Back</MdTextButton>
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
  );
}

