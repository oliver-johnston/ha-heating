import { FormEvent, useEffect, useMemo, useState } from "react";

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
  area_name: string | null;
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
  const area = option.area_name ? `${option.area_name} · ` : "";
  const state = option.state && option.state !== "unknown" ? ` · ${option.state}${option.unit ?? ""}` : "";
  return `${area}${option.name}${state}`;
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
          <h1>Connect your heating system</h1>
          <p className="lede">
            Choose the SONOFF valves this add-on will own. Their supporting entities are mapped
            automatically from the Home Assistant device registry.
          </p>
        </div>
        <div className="header-actions">
          <button className="secondary" type="button" onClick={() => void load()}>
            Rescan devices
          </button>
          <div className={`status ${saved ? "configured" : "draft"}`}>
            <span className="status-dot" />
            {saved ? "Configured" : "Not configured"}
          </div>
        </div>
      </header>

      {error && <div className="message error"><strong>Couldn’t continue.</strong> {error}</div>}
      {notice && <div className="message success">{notice}</div>}

      {!discovery ? (
        <section className="empty-state">
          <h2>Home Assistant is unavailable</h2>
          <button type="button" onClick={() => void load()}>Try again</button>
        </section>
      ) : (
        <form onSubmit={save}>
          <section className="section-heading">
            <div>
              <p className="step">Step 1</p>
              <h2>Radiator valves</h2>
              <p>{discovery.trvs.length} compatible SONOFF valve{discovery.trvs.length === 1 ? "" : "s"} found.</p>
            </div>
            <span className="selection-count">{selectedCount} selected</span>
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
                      <input
                        type="checkbox"
                        checked={selection.enabled}
                        onChange={(event) => updateSelection(trv.device_id, { enabled: event.target.checked })}
                      />
                      <span>
                        <strong>{trv.name}</strong>
                        <small>
                          {[trv.area_name, trv.model, trv.software_version && `Firmware ${trv.software_version}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                    </label>

                    {selection.enabled && (
                      <div className="trv-fields">
                        <label>
                          Room group
                          <input
                            required
                            maxLength={80}
                            value={selection.room_group}
                            onChange={(event) => updateSelection(trv.device_id, { room_group: event.target.value })}
                            placeholder="e.g. Kitchen"
                          />
                        </label>
                        <label>
                          External temperature sensor <span className="optional">optional</span>
                          <select
                            value={selection.external_temperature_sensor}
                            onChange={(event) => updateSelection(trv.device_id, { external_temperature_sensor: event.target.value })}
                          >
                            <option value="">Use the valve’s own temperature</option>
                            {discovery.temperature_sensors.map((sensor) => (
                              <option value={sensor.entity_id} key={sensor.entity_id}>
                                {optionLabel(sensor)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <details>
                          <summary>
                            {Object.values(trv.entities).filter(Boolean).length} device entities mapped
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
              <p className="step">Step 2</p>
              <h2>Boiler and hot water</h2>
              <p>Select the two relays the controller will eventually operate.</p>
            </div>
          </section>

          <section className="plant-card">
            <label>
              Central-heating switch
              <select required value={boilerSwitch} onChange={(event) => setBoilerSwitch(event.target.value)}>
                <option value="">Select a switch</option>
                {discovery.switches.map((item) => (
                  <option value={item.entity_id} key={item.entity_id}>{optionLabel(item)}</option>
                ))}
              </select>
            </label>
            <label>
              Hot-water switch
              <select required value={hotWaterSwitch} onChange={(event) => setHotWaterSwitch(event.target.value)}>
                <option value="">Select a switch</option>
                {discovery.switches.map((item) => (
                  <option value={item.entity_id} key={item.entity_id}>{optionLabel(item)}</option>
                ))}
              </select>
            </label>
          </section>

          <footer className="save-bar">
            <div>
              <strong>{selectedCount} valves ready to configure</strong>
              <span>This onboarding release will not operate any heating devices.</span>
            </div>
            <button type="submit" disabled={saving || selectedCount === 0}>
              {saving ? "Verifying…" : "Save configuration"}
            </button>
          </footer>
        </form>
      )}
    </main>
  );
}
