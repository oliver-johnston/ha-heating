import type { Dispatch, SetStateAction } from "react";
import { MdDialog, MdFilledButton, MdTextButton } from "../material";
import {
  OverrideDialog,
  type ActiveHotWaterOverride,
  type ActiveTemperatureOverride,
  type OverrideActionPayload,
  type OverrideTarget,
} from "../OverrideDialog";
import { WarningIcon } from "../components/AppChrome";
import {
  CompactRelayCard,
  CompactRoomIcons,
  DetailedRoomCard,
  OverrideActionButton,
  RelayDetails,
  RoomDetails,
  formatCompactTemperature,
  formatNextHotWaterChange,
  formatTemperature,
  overrideSummary,
  roomHasDeviceIssue,
  temperatureOverrideFor,
} from "../components/HeatingCards";
import { relayStatus, scheduleValueName } from "../uiHelpers";
import type {
  DashboardData,
  DashboardRoom,
  SavedConfig,
  TemperaturePresets,
} from "../types";

type Props = {
  loading: boolean;
  dashboard: DashboardData | null;
  saved: SavedConfig | null;
  detailedDashboard: boolean;
  dashboardPresets: TemperaturePresets;
  overrideSaving: string;
  selectedDashboardRoom: DashboardRoom | null;
  setSelectedDashboardRoomId: Dispatch<SetStateAction<string | null>>;
  selectedDashboardRelay: "heating" | "hot_water" | null;
  setSelectedDashboardRelay: Dispatch<SetStateAction<"heating" | "hot_water" | null>>;
  overrideTarget: OverrideTarget | null;
  setOverrideTarget: Dispatch<SetStateAction<OverrideTarget | null>>;
  activeOverride: ActiveTemperatureOverride | ActiveHotWaterOverride | null;
  onOpenControlSettings: () => void;
  onReload: () => void;
  saveOverride: (payload: OverrideActionPayload) => Promise<void>;
  clearOverride: (payload: OverrideActionPayload) => Promise<void>;
};

export function DashboardPage({
  loading: dashboardLoading,
  dashboard,
  saved,
  detailedDashboard,
  dashboardPresets,
  overrideSaving,
  selectedDashboardRoom,
  setSelectedDashboardRoomId,
  selectedDashboardRelay,
  setSelectedDashboardRelay,
  overrideTarget,
  setOverrideTarget,
  activeOverride,
  onOpenControlSettings,
  onReload,
  saveOverride,
  clearOverride,
}: Props) {
  const compactThreshold = saved?.control.hysteresis ?? 0;
  const compactTemperature = (room: DashboardRoom) =>
    formatCompactTemperature(
      room.current_temperature,
      room.scheduled_temperature,
      compactThreshold,
      room.unit,
    );

  return (
        <section className="dashboard" aria-live="polite">
          {dashboardLoading && !dashboard ? (
            <div className="loading">Loading room temperatures…</div>
          ) : dashboard ? (
            <div className="dashboard-content">
              {!dashboard.controller.enabled && (
                <section className="monitoring-warning" role="status">
                  <WarningIcon />
                  <strong>Monitoring only: TRVs will not be controlled</strong>
                  <MdTextButton type="button" onClick={() => onOpenControlSettings()}>
                    Control settings
                  </MdTextButton>
                </section>
              )}
              {dashboard.issues.length > 0 && (
                <section className="dashboard-issues" aria-label="Current issues">
                  {dashboard.issues.map((issue, index) => (
                    <article
                      className={`diagnostic-issue ${issue.severity}`}
                      key={`${issue.title}-${index}`}
                    >
                      <WarningIcon />
                      <div>
                        <strong>{issue.title}</strong>
                        <p>{issue.detail}</p>
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {(saved?.boiler_switch || saved?.hot_water_switch) && (
                <section className="room-group relay-status-group">
                  <div
                    className={`room-grid relay-status-grid ${detailedDashboard ? "" : "compact-relay-grid"}`}
                  >
                    {saved.boiler_switch && (() => {
                      const status = relayStatus(
                        dashboard.controller.boiler_is_on,
                        dashboard.controller.boiler_should_be_on,
                      );
                      const override = temperatureOverrideFor(dashboard, "house", null);
                      if (!detailedDashboard) {
                        return (
                          <CompactRelayCard
                            name="Central heating"
                            actual={dashboard.controller.boiler_is_on}
                            status={status}
                            onOpen={() => setSelectedDashboardRelay("heating")}
                            overrideAction={(
                              <OverrideActionButton
                                active={override}
                                presets={dashboardPresets}
                                targetLabel="the whole house"
                                disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                                onClick={() => setOverrideTarget({
                                  channel: "temperature",
                                  scopeType: "house",
                                  scopeId: null,
                                  label: "Whole house",
                                })}
                              />
                            )}
                          />
                        );
                      }
                      return (
                        <article
                          className={`room-card relay-status-card relay-status-${status}${status === "unavailable" ? " has-device-issue" : ""}`}
                        >
                          <RelayDetails
                            name="Central heating"
                            actual={dashboard.controller.boiler_is_on}
                            requested={dashboard.controller.boiler_should_be_on}
                            technicalLabel="Heat requests"
                            technicalValue={`${dashboard.controller.heat_requests} of ${dashboard.controller.minimum_heat_requests}`}
                            overrideAction={<OverrideActionButton
                              active={override}
                              presets={dashboardPresets}
                              targetLabel="the whole house"
                              disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                              onClick={() => setOverrideTarget({
                                channel: "temperature",
                                scopeType: "house",
                                scopeId: null,
                                label: "Whole house",
                              })}
                            />}
                          />
                        </article>
                      );
                    })()}
                    {saved.hot_water_switch && (() => {
                      const status = relayStatus(
                        dashboard.controller.hot_water_is_on,
                        dashboard.controller.hot_water_should_be_on,
                      );
                      if (!detailedDashboard) {
                        return (
                          <CompactRelayCard
                            name="Hot water"
                            actual={dashboard.controller.hot_water_is_on}
                            status={status}
                            onOpen={() => setSelectedDashboardRelay("hot_water")}
                            overrideAction={(
                              <OverrideActionButton
                                active={dashboard.overrides.hot_water_override ?? null}
                                presets={dashboardPresets}
                                targetLabel="hot water"
                                disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                                onClick={() => setOverrideTarget({
                                  channel: "hot_water",
                                  scopeType: "hot_water",
                                  scopeId: null,
                                  label: "Hot water",
                                })}
                              />
                            )}
                          />
                        );
                      }
                      return (
                        <article
                          className={`room-card relay-status-card relay-status-${status}${status === "unavailable" ? " has-device-issue" : ""}`}
                        >
                          <RelayDetails
                            name="Hot water"
                            actual={dashboard.controller.hot_water_is_on}
                            requested={dashboard.controller.hot_water_should_be_on}
                            technicalLabel={dashboard.overrides.hot_water_override ? "Override" : "Next change"}
                            technicalValue={dashboard.overrides.hot_water_override
                                ? overrideSummary(
                                    dashboard.overrides.hot_water_override,
                                    dashboardPresets,
                                  )
                                : formatNextHotWaterChange(dashboard.controller)}
                            overrideAction={<OverrideActionButton
                              active={dashboard.overrides.hot_water_override ?? null}
                              presets={dashboardPresets}
                              targetLabel="hot water"
                              disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                              onClick={() => setOverrideTarget({
                                channel: "hot_water",
                                scopeType: "hot_water",
                                scopeId: null,
                                label: "Hot water",
                              })}
                            />}
                          />
                        </article>
                      );
                    })()}
                  </div>
                </section>
              )}
              <div className="room-groups">
              {dashboard.groups.map((group) => {
                const override = temperatureOverrideFor(dashboard, "group", group.name);
                return <section className="room-group" key={group.name}>
                  <header className="room-group-header">
                    <div>
                      <h2 className="md-typescale-headline-small">{group.name}</h2>
                      <span>{group.rooms.length} room{group.rooms.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="room-override-control">
                      <OverrideActionButton
                        active={override}
                        presets={dashboardPresets}
                        targetLabel={group.name}
                        disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                        onClick={() => setOverrideTarget({
                          channel: "temperature",
                          scopeType: "group",
                          scopeId: group.name,
                          label: group.name,
                        })}
                      />
                    </div>
                  </header>
                  <div className={`room-grid ${detailedDashboard ? "" : "compact-room-grid"}`}>
                    {group.rooms.map((room) =>
                      detailedDashboard ? (
                        <DetailedRoomCard
                          room={room}
                          key={room.device_id}
                          activeOverride={temperatureOverrideFor(
                            dashboard,
                            "room",
                            room.device_id,
                          )}
                          presets={dashboardPresets}
                          overrideDisabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                          onOverride={() => setOverrideTarget({
                            channel: "temperature",
                            scopeType: "room",
                            scopeId: room.device_id,
                            label: room.name,
                          })}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`compact-room-card room-status-${room.status}${roomHasDeviceIssue(room) ? " has-device-issue" : ""}`}
                          key={room.device_id}
                          aria-label={`Open details for ${room.name}, ${compactTemperature(room)}, ${scheduleValueName(room.preset)}${room.override_scope_type === "room" ? ", room override active" : ""}${roomHasDeviceIssue(room) ? ", device issue" : ""}`}
                          onClick={() => setSelectedDashboardRoomId(room.device_id)}
                        >
                          <span className="compact-room-name">{room.name}</span>
                          <strong>{compactTemperature(room)}</strong>
                          <CompactRoomIcons room={room} />
                        </button>
                      ),
                    )}
                  </div>
                </section>;
              })}
              </div>
              {selectedDashboardRoom && (
                <MdDialog
                  open
                  className={`room-detail-dialog room-status-${selectedDashboardRoom.status}${roomHasDeviceIssue(selectedDashboardRoom) ? " has-device-issue" : ""}`}
                  aria-label={`Room details for ${selectedDashboardRoom.name}`}
                  onCancel={() => setSelectedDashboardRoomId(null)}
                  onClosed={() => setSelectedDashboardRoomId(null)}
                >
                  <div
                    slot="content"
                    className="room-detail-dialog-content"
                    tabIndex={0}
                    autoFocus
                  >
                    <button
                      type="button"
                      className="room-detail-dialog-close"
                      aria-label="Close room details"
                      onClick={() => setSelectedDashboardRoomId(null)}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.71 2.88 18.3 9.17 12 2.88 5.7l1.41-1.41 6.3 6.3 6.3-6.3 1.41 1.42Z" />
                      </svg>
                    </button>
                    <RoomDetails
                      room={selectedDashboardRoom}
                      activeOverride={temperatureOverrideFor(
                        dashboard,
                        "room",
                        selectedDashboardRoom.device_id,
                      )}
                      presets={dashboardPresets}
                      overrideDisabled={
                        !dashboard.controller.enabled || Boolean(overrideSaving)
                      }
                      onOverride={() => {
                        setSelectedDashboardRoomId(null);
                        setOverrideTarget({
                          channel: "temperature",
                          scopeType: "room",
                          scopeId: selectedDashboardRoom.device_id,
                          label: selectedDashboardRoom.name,
                        });
                      }}
                    />
                  </div>
                </MdDialog>
              )}
              {selectedDashboardRelay && (
                <MdDialog
                  open
                  className={`room-detail-dialog${relayStatus(
                    selectedDashboardRelay === "heating"
                      ? dashboard.controller.boiler_is_on
                      : dashboard.controller.hot_water_is_on,
                    selectedDashboardRelay === "heating"
                      ? dashboard.controller.boiler_should_be_on
                      : dashboard.controller.hot_water_should_be_on,
                  ) === "unavailable" ? " has-device-issue" : ""}`}
                  aria-label={`${selectedDashboardRelay === "heating" ? "Central heating" : "Hot water"} details`}
                  onCancel={() => setSelectedDashboardRelay(null)}
                  onClosed={() => setSelectedDashboardRelay(null)}
                >
                  <div
                    slot="content"
                    className="room-detail-dialog-content"
                    tabIndex={0}
                    autoFocus
                  >
                    <button
                      type="button"
                      className="room-detail-dialog-close"
                      aria-label={`Close ${selectedDashboardRelay === "heating" ? "central heating" : "hot water"} details`}
                      onClick={() => setSelectedDashboardRelay(null)}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.71 2.88 18.3 9.17 12 2.88 5.7l1.41-1.41 6.3 6.3 6.3-6.3 1.41 1.42Z" />
                      </svg>
                    </button>
                    {selectedDashboardRelay === "heating" ? (() => {
                      const override = temperatureOverrideFor(dashboard, "house", null);
                      return (
                        <RelayDetails
                          name="Central heating"
                          actual={dashboard.controller.boiler_is_on}
                          requested={dashboard.controller.boiler_should_be_on}
                          technicalLabel="Heat requests"
                          technicalValue={`${dashboard.controller.heat_requests} of ${dashboard.controller.minimum_heat_requests}`}
                          overrideAction={<OverrideActionButton
                            active={override}
                            presets={dashboardPresets}
                            targetLabel="the whole house"
                            disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                            onClick={() => {
                              setSelectedDashboardRelay(null);
                              setOverrideTarget({
                                channel: "temperature",
                                scopeType: "house",
                                scopeId: null,
                                label: "Whole house",
                              });
                            }}
                          />}
                        />
                      );
                    })() : (() => {
                      return (
                        <RelayDetails
                          name="Hot water"
                          actual={dashboard.controller.hot_water_is_on}
                          requested={dashboard.controller.hot_water_should_be_on}
                          technicalLabel={dashboard.overrides.hot_water_override ? "Override" : "Next change"}
                          technicalValue={dashboard.overrides.hot_water_override
                            ? overrideSummary(
                                dashboard.overrides.hot_water_override,
                                dashboardPresets,
                              )
                            : formatNextHotWaterChange(dashboard.controller)}
                          overrideAction={<OverrideActionButton
                            active={dashboard.overrides.hot_water_override ?? null}
                            presets={dashboardPresets}
                            targetLabel="hot water"
                            disabled={!dashboard.controller.enabled || Boolean(overrideSaving)}
                            onClick={() => {
                              setSelectedDashboardRelay(null);
                              setOverrideTarget({
                                channel: "hot_water",
                                scopeType: "hot_water",
                                scopeId: null,
                                label: "Hot water",
                              });
                            }}
                          />}
                        />
                      );
                    })()}
                  </div>
                </MdDialog>
              )}
              {overrideTarget && (
                <OverrideDialog
                  target={overrideTarget}
                  presets={dashboardPresets}
                  active={activeOverride}
                  disabled={!dashboard.controller.enabled}
                  saving={Boolean(overrideSaving)}
                  onClose={() => {
                    if (!overrideSaving) setOverrideTarget(null);
                  }}
                  onSubmit={(payload) => void saveOverride(payload)}
                  onClear={(payload) => void clearOverride(payload)}
                />
              )}
            </div>
          ) : (
            <div className="empty-state">
              <h2 className="md-typescale-headline-small">Room temperatures are unavailable</h2>
              <MdFilledButton type="button" onClick={() => onReload()}>Try again</MdFilledButton>
            </div>
          )}
        </section>
  );
}
