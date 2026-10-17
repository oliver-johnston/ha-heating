import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import {
  MdCheckbox,
  MdFilledButton,
  MdOutlinedSelect,
  MdOutlinedTextField,
  MdSelectOption,
  MdTextButton,
} from "../../material";
import {
  eventChecked,
  eventValue,
  friendlyRole,
  healthOptionHeadline,
  selectionIsConfigured,
  sensorOptionHeadline,
} from "../../uiHelpers";
import { ControlSettingRow } from "../../components/HeatingCards";
import type { ControlValues, Discovery, Selection } from "../../types";

type Props = {
  discovery: Discovery;
  selections: Record<string, Selection>;
  selectedCount: number;
  expandedDevices: Set<string>;
  setExpandedDevices: Dispatch<SetStateAction<Set<string>>>;
  updateSelection: (deviceId: string, patch: Partial<Selection>) => void;
  control: ControlValues;
  setupComplete: boolean;
  saving: boolean;
  notice: string;
  visibleError: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onRescan: () => void;
  onRevert: () => void;
};

export function RadiatorsSettingsPage({
  discovery,
  selections,
  selectedCount,
  expandedDevices,
  setExpandedDevices,
  updateSelection,
  control,
  setupComplete,
  saving,
  notice,
  visibleError,
  onSubmit: save,
  onRescan,
  onRevert,
}: Props) {
  return (
    <form onSubmit={save}>
          <section className="section-heading radiator-section-heading">
            <div>
              <h2 className="md-typescale-headline-small">Radiator valves</h2>
              <p>Select each room you want to control.</p>
            </div>
            <div className="radiator-heading-actions">
              <span className="selection-count">
                {selectedCount} of {discovery.trvs.length} selected
              </span>
              <MdTextButton type="button" onClick={onRescan}>
                Rescan devices
              </MdTextButton>
            </div>
          </section>

          {discovery.trvs.length === 0 ? (
            <div className="message error">No SONOFF TRVZB devices with climate entities were found.</div>
          ) : (
            <div className="trv-grid">
              {discovery.trvs.map((trv) => {
                const selection = selections[trv.device_id];
                if (!selection) return null;
                const configured = selectionIsConfigured(selection, discovery);
                const collapsed = configured && !expandedDevices.has(trv.device_id);
                const externalSensor = discovery.temperature_sensors.find(
                  (sensor) => sensor.entity_id === selection.external_temperature_sensor,
                );
                if (collapsed) {
                  return (
                    <article className="trv-card selected configured" key={trv.device_id}>
                      <div className="configured-trv-summary">
                        <span className="configured-check" aria-label="Configured correctly">
                          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
                          </svg>
                        </span>
                        <div className="configured-device-names">
                          <strong>{trv.name}</strong>
                          {externalSensor && (
                            <small>{externalSensor.device_name ?? externalSensor.name}</small>
                          )}
                        </div>
                        <MdTextButton
                          type="button"
                          aria-label={`Edit ${trv.name}`}
                          onClick={() =>
                            setExpandedDevices((current) => {
                              const next = new Set(current);
                              next.add(trv.device_id);
                              return next;
                            })
                          }
                        >
                          Edit
                        </MdTextButton>
                      </div>
                    </article>
                  );
                }
                return (
                  <article className={`trv-card ${selection.enabled ? "selected" : ""}`} key={trv.device_id}>
                    <div className="trv-expanded-header">
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
                      {configured && (
                        <MdTextButton
                          type="button"
                          onClick={() =>
                            setExpandedDevices((current) => {
                              const next = new Set(current);
                              next.delete(trv.device_id);
                              return next;
                            })
                          }
                        >
                          Done
                        </MdTextButton>
                      )}
                    </div>

                    {selection.enabled && (
                      <div className="trv-fields control-fields">
                        <ControlSettingRow
                          title="Room group"
                          description="Rooms in the same group share a schedule and group-level overrides."
                        >
                          <MdOutlinedTextField
                            maxLength={80}
                            label="Group"
                            value={selection.room_group}
                            onInput={(event) =>
                              updateSelection(trv.device_id, { room_group: eventValue(event) })
                            }
                          />
                        </ControlSettingRow>
                        <ControlSettingRow
                          title="External temperature sensor"
                          description="Optional; used for room demand while the valve continues using its own sensor."
                        >
                          <MdOutlinedSelect
                            label="Sensor"
                            value={selection.external_temperature_sensor}
                            onChange={(event) => {
                              const entityId = eventValue(event);
                              const healthEntity = discovery.temperature_sensors.find(
                                (sensor) => sensor.entity_id === entityId,
                              )?.suggested_last_seen_entity;
                              updateSelection(trv.device_id, {
                                external_temperature_sensor: entityId,
                                external_temperature_last_seen: healthEntity ?? "",
                                external_temperature_freshness: healthEntity
                                  ? "last_seen"
                                  : "state_updates",
                                predictive_heating_enabled:
                                  entityId === selection.external_temperature_sensor
                                    ? selection.predictive_heating_enabled
                                    : false,
                              });
                            }}
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
                        </ControlSettingRow>
                        {selection.external_temperature_sensor && (
                          <>
                            <ControlSettingRow
                              title="External sensor health"
                              description="How the add-on determines whether the external reading is still trustworthy."
                            >
                              <MdOutlinedSelect
                                label="Health source"
                                value={
                                  selection.external_temperature_freshness === "last_seen"
                                    ? selection.external_temperature_last_seen
                                    : `__${selection.external_temperature_freshness}__`
                                }
                                onChange={(event) => {
                                  const value = eventValue(event);
                                  updateSelection(trv.device_id, {
                                    external_temperature_freshness:
                                      value === "__state_updates__"
                                        ? "state_updates"
                                        : value === "__disabled__"
                                          ? "disabled"
                                          : "last_seen",
                                    external_temperature_last_seen: value.startsWith("__")
                                      ? ""
                                      : value,
                                  });
                                }}
                              >
                                {discovery.health_sensors.map((sensor) => (
                                  <MdSelectOption
                                    value={sensor.entity_id}
                                    displayText={healthOptionHeadline(sensor)}
                                    key={sensor.entity_id}
                                  >
                                    <span slot="headline">{healthOptionHeadline(sensor)}</span>
                                  </MdSelectOption>
                                ))}
                                <MdSelectOption value="__state_updates__">
                                  Use temperature updates
                                </MdSelectOption>
                                <MdSelectOption value="__disabled__">
                                  Do not check freshness
                                </MdSelectOption>
                              </MdOutlinedSelect>
                            </ControlSettingRow>
                            {selection.external_temperature_freshness !== "disabled" && (
                              <ControlSettingRow
                                title="External sensor stale time"
                                description={`Fall back to the valve sensor after this long; blank uses ${Math.round(
                                  Number(control.external_sensor_stale_minutes),
                                )} minutes.`}
                              >
                                <MdOutlinedTextField
                                  type="number"
                                  min="5"
                                  max="1440"
                                  step="5"
                                  label="Minutes (optional)"
                                  value={selection.external_sensor_stale_minutes}
                                  onInput={(event) =>
                                    updateSelection(trv.device_id, {
                                      external_sensor_stale_minutes: eventValue(event),
                                    })
                                  }
                                />
                              </ControlSettingRow>
                            )}
                          </>
                        )}
                        <details>
                          <summary>
                            Technical details · {Object.values(trv.entities).filter(Boolean).length} entities
                          </summary>
                          <ControlSettingRow
                            title="TRV health"
                            description="How the add-on determines whether the valve is available for control."
                          >
                            <MdOutlinedSelect
                              label="Health source"
                              value={
                                selection.trv_freshness === "last_seen"
                                  ? selection.trv_last_seen
                                  : `__${selection.trv_freshness}__`
                              }
                              onChange={(event) => {
                                const value = eventValue(event);
                                updateSelection(trv.device_id, {
                                  trv_freshness:
                                    value === "__state_updates__"
                                      ? "state_updates"
                                      : value === "__disabled__"
                                        ? "disabled"
                                        : "last_seen",
                                  trv_last_seen: value.startsWith("__") ? "" : value,
                                });
                              }}
                            >
                              {discovery.health_sensors.map((sensor) => (
                                <MdSelectOption
                                  value={sensor.entity_id}
                                  displayText={healthOptionHeadline(sensor)}
                                  key={sensor.entity_id}
                                >
                                  <span slot="headline">{healthOptionHeadline(sensor)}</span>
                                </MdSelectOption>
                              ))}
                              <MdSelectOption value="__state_updates__">
                                Use TRV state updates
                              </MdSelectOption>
                              <MdSelectOption value="__disabled__">
                                Do not check freshness
                              </MdSelectOption>
                            </MdOutlinedSelect>
                          </ControlSettingRow>
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

          <footer className="save-bar">
            <div className="save-actions">
              {setupComplete && (
                <MdTextButton
                  type="button"
                  disabled={saving}
                  onClick={() => onRevert()}
                >
                  Revert
                </MdTextButton>
              )}
              <MdFilledButton type="submit" disabled={saving || selectedCount === 0}>
                {saving ? "Verifying…" : "Save configuration"}
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
