import { MdOutlinedSelect, MdSelectOption } from "../../material";
import { ControlSettingRow } from "../../components/HeatingCards";
import { eventValue } from "../../uiHelpers";
import type { ThemeId } from "../../theme";

type Props = {
  theme: ThemeId;
  onChange: (theme: ThemeId) => void;
};

export function ThemeSettingsPage({ theme, onChange }: Props) {
  return (
    <section>
      <header className="section-heading">
        <div>
          <h2 className="md-typescale-headline-small">Theme</h2>
          <p>Choose how Heat Steward looks on this browser or device.</p>
        </div>
      </header>

      <section className="settings-list">
        <div className="control-fields">
          <ControlSettingRow
            title="Appearance"
            description="Applies immediately and is remembered separately on each browser or device."
          >
            <MdOutlinedSelect
              label="Theme"
              value={theme}
              onChange={(event) => onChange(eventValue(event) as ThemeId)}
            >
              <MdSelectOption value="material-light">Material Light</MdSelectOption>
              <MdSelectOption value="ios-dark">iOS Dark</MdSelectOption>
            </MdOutlinedSelect>
          </ControlSettingRow>
        </div>
      </section>
    </section>
  );
}
