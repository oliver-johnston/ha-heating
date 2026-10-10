import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  MdCheckbox,
  MdFilledButton,
  MdOutlinedSelect,
  MdOutlinedTextField,
  MdSelectOption,
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

type SavedConfig = {
  boiler_switch: string;
  hot_water_switch: string;
  trvs: SavedTRV[];
  updated_at: string;
};

type Selection = {
  enabled: boolean;
  room_group: string;
  external_temperature_sensor: string;
};

const api = (path: string) => `./api/${path}`;

function friendlyRole(role: string) {
  return role.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
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

export default function App() {
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [saved, setSaved] = useState<SavedConfig | null>(null);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [boilerSwitch, setBoilerSwitch] = useState("");
  const [hotWaterSwitch, setHotWaterSwitch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [discoveryResponse, configResponse] = await Promise.all([
        fetch(api("onboarding/discovery")),
        fetch(api("config")),
      ]);
      const discoveryBody = await discoveryResponse.json();
      const configBody = await configResponse.json();
      if (!discoveryResponse.ok) throw new Error(discoveryBody.error || "Discovery failed");
      if (!configResponse.ok) throw new Error(configBody.error || "Could not load configuration");

      const found = discoveryBody as Discovery;
      const existing = (configBody.config ?? null) as SavedConfig | null;
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
      setSaved(existing);
      setSelections(nextSelections);
      setBoilerSwitch(existing?.boiler_switch ?? found.suggested.boiler_switch ?? "");
      setHotWaterSwitch(existing?.hot_water_switch ?? found.suggested.hot_water_switch ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedCount = useMemo(
    () => Object.values(selections).filter((selection) => selection.enabled).length,
    [selections],
  );

  function updateSelection(deviceId: string, patch: Partial<Selection>) {
    setSelections((current) => ({
      ...current,
      [deviceId]: { ...current[deviceId], ...patch },
    }));
    setNotice("");
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
        body: JSON.stringify({ trvs, boiler_switch: boilerSwitch, hot_water_switch: hotWaterSwitch }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save configuration");
      setSaved(body.config as SavedConfig);
      setNotice("Configuration saved and verified against Home Assistant.");
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
      <header className="page-header">
        <div>
          <p className="eyebrow">Home Heating</p>
          <h1 className="md-typescale-display-medium">Set up your heating</h1>
          <p className="lede md-typescale-body-large">
            Choose the radiator valves and boiler switches you want this add-on to control.
          </p>
        </div>
        <div className="header-actions">
          <div className={`status ${saved ? "configured" : "draft"}`}>
            <span className="status-dot" />
            {saved ? "Configured" : "Not configured"}
          </div>
          <MdTextButton type="button" onClick={() => void load()}>
            Rescan devices
          </MdTextButton>
        </div>
      </header>

      {error && <div className="message error"><strong>Couldn’t continue.</strong> {error}</div>}
      {notice && <div className="message success">{notice}</div>}

      {!discovery ? (
        <section className="empty-state">
          <h2 className="md-typescale-headline-small">Home Assistant is unavailable</h2>
          <MdFilledButton type="button" onClick={() => void load()}>Try again</MdFilledButton>
        </section>
      ) : (
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

          <section className="section-heading plant-heading">
            <div>
              <h2 className="md-typescale-headline-small">Boiler switches</h2>
              <p>Choose the relays for central heating and hot water.</p>
            </div>
          </section>

          <section className="plant-card">
            <MdOutlinedSelect
              required
              label="Central-heating switch"
              value={boilerSwitch}
              onChange={(event) => setBoilerSwitch(eventValue(event))}
            >
                <MdSelectOption value="">Select a switch</MdSelectOption>
                {discovery.switches.map((item) => (
                  <MdSelectOption value={item.entity_id} key={item.entity_id}>
                    {optionLabel(item)}
                  </MdSelectOption>
                ))}
            </MdOutlinedSelect>
            <MdOutlinedSelect
              required
              label="Hot-water switch"
              value={hotWaterSwitch}
              onChange={(event) => setHotWaterSwitch(eventValue(event))}
            >
                <MdSelectOption value="">Select a switch</MdSelectOption>
                {discovery.switches.map((item) => (
                  <MdSelectOption value={item.entity_id} key={item.entity_id}>
                    {optionLabel(item)}
                  </MdSelectOption>
                ))}
            </MdOutlinedSelect>
          </section>

          <footer className="save-bar">
            <div>
              <strong>{selectedCount} radiator valve{selectedCount === 1 ? "" : "s"} selected</strong>
              <span>This onboarding release will not operate any heating devices.</span>
            </div>
            <MdFilledButton type="submit" disabled={saving || selectedCount === 0}>
              {saving ? "Verifying…" : "Save configuration"}
            </MdFilledButton>
          </footer>
          {notice && (
            <div className="message success bottom-notice" role="status">
              {notice}
            </div>
          )}
        </form>
      )}
    </main>
  );
}
