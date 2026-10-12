import type { FormEventHandler } from "react";
import {
  MdFilledButton,
  MdOutlinedSelect,
  MdOutlinedTextField,
  MdSelectOption,
  MdTextButton,
} from "../../material";
import { ControlSettingRow } from "../../components/HeatingCards";
import { eventValue, optionLabel } from "../../uiHelpers";
import type { Discovery } from "../../types";

type Props = {
  discovery: Discovery;
  boilerSwitch: string;
  setBoilerSwitch: (value: string) => void;
  hotWaterSwitch: string;
  setHotWaterSwitch: (value: string) => void;
  minimumHeatRequests: string;
  setMinimumHeatRequests: (value: string) => void;
  minimumHeatRequestsValid: boolean;
  maximumHeatRequests: number;
  setupComplete: boolean;
  boilerSetupComplete: boolean;
  saving: boolean;
  notice: string;
  visibleError: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onSkip: () => void;
  onBack: () => void;
  onRevert: () => void;
  onDirty: () => void;
};

export function BoilerSettingsPage({
  discovery,
  boilerSwitch,
  setBoilerSwitch,
  hotWaterSwitch,
  setHotWaterSwitch,
  minimumHeatRequests,
  setMinimumHeatRequests,
  minimumHeatRequestsValid,
  maximumHeatRequests,
  setupComplete,
  boilerSetupComplete,
  saving,
  notice,
  visibleError,
  onSubmit: saveBoiler,
  onSkip,
  onBack,
  onRevert,
  onDirty,
}: Props) {
  return (
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
                      onDirty();
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
                      onDirty();
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
                      onDirty();
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
                  onClick={() => onRevert()}
                >
                  Revert
                </MdTextButton>
              ) : (
                <MdTextButton type="button" onClick={() => onBack()}>Back</MdTextButton>
              )}
              {!boilerSetupComplete && (
                <MdTextButton
                  type="button"
                  disabled={saving}
                  onClick={() => onSkip()}
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
  );
}
