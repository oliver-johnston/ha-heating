import type { FormEventHandler } from "react";
import {
  MdFilledButton,
  MdOutlinedSelect,
  MdOutlinedTextField,
  MdSelectOption,
  MdTextButton,
} from "../../material";
import { HOT_WATER_SCHEDULE_KEY, WEEKDAYS } from "../../configForms";
import { eventValue, scheduleValueName, timeMinutes } from "../../uiHelpers";
import type {
  HotWaterState,
  PresetKey,
  RoomSchedule,
  Weekday,
} from "../../types";

type ActivePeriod = {
  days: Weekday[];
  start: string;
  end: string;
  value: PresetKey | HotWaterState;
};

type Definition = { key: PresetKey | HotWaterState; name: string };

type Props = {
  schedules: RoomSchedule[];
  selectedRoomGroup: string;
  setSelectedRoomGroup: (value: string) => void;
  selectedSchedule: RoomSchedule | undefined;
  editingHotWater: boolean;
  activeScheduleName: string;
  activeDefaultValue: PresetKey | HotWaterState;
  activePeriods: ActivePeriod[];
  activeDefinitions: Definition[];
  hotWaterConfigured: boolean;
  setupComplete: boolean;
  saving: boolean;
  notice: string;
  visibleError: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  updateDefaultScheduleValue: (value: string) => void;
  addPeriod: () => void;
  removePeriod: (index: number) => void;
  togglePeriodDay: (index: number, day: Weekday) => void;
  updatePeriod: (
    index: number,
    patch: Partial<{ days: Weekday[]; start: string; end: string; value: PresetKey | HotWaterState }>,
  ) => void;
  onBack: () => void;
  onRevert: () => void;
};

export function SchedulesSettingsPage({
  schedules,
  selectedRoomGroup,
  setSelectedRoomGroup,
  selectedSchedule,
  editingHotWater,
  activeScheduleName,
  activeDefaultValue,
  activePeriods,
  activeDefinitions,
  hotWaterConfigured,
  setupComplete,
  saving,
  notice,
  visibleError,
  onSubmit: saveSchedules,
  updateDefaultScheduleValue,
  addPeriod,
  removePeriod,
  togglePeriodDay,
  updatePeriod,
  onBack,
  onRevert,
}: Props) {
  return (
        <form onSubmit={saveSchedules}>
          <section className="section-heading schedule-heading">
            <div>
              <h2 className="md-typescale-headline-small">Weekly schedules</h2>
              <p>Set timed overrides for room groups and hot water.</p>
            </div>
            <MdOutlinedSelect
              label="Schedule"
              value={selectedRoomGroup}
              onChange={(event) => setSelectedRoomGroup(eventValue(event))}
            >
              {schedules.map((schedule) => (
                <MdSelectOption value={schedule.room_group} key={schedule.room_group}>
                  {schedule.room_group}
                </MdSelectOption>
              ))}
              {hotWaterConfigured && (
                <MdSelectOption value={HOT_WATER_SCHEDULE_KEY}>Hot water</MdSelectOption>
              )}
            </MdOutlinedSelect>
          </section>

          {(selectedSchedule || editingHotWater) && (
            <>
              <section className="schedule-overview" aria-label={`${activeScheduleName} weekly schedule`}>
                <div className="schedule-overview-header">
                  <div>
                    <h3 className="md-typescale-title-large">{activeScheduleName}</h3>
                    <p>At a glance</p>
                  </div>
                  <MdOutlinedSelect
                    label={editingHotWater ? "Default state" : "Default preset"}
                    value={activeDefaultValue}
                    onChange={(event) => updateDefaultScheduleValue(eventValue(event))}
                  >
                    {activeDefinitions.map((definition) => (
                      <MdSelectOption
                        value={definition.key}
                        displayText={definition.name}
                        key={definition.key}
                      >
                        {definition.name}
                      </MdSelectOption>
                    ))}
                  </MdOutlinedSelect>
                </div>
                <div className="timeline-axis" aria-hidden="true">
                  <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
                </div>
                <div className="weekly-timeline">
                  {WEEKDAYS.map((day) => (
                    <div className="timeline-row" key={day.key}>
                      <strong>{day.short}</strong>
                      <div
                        className={`timeline-track preset-${activeDefaultValue}`}
                        aria-label={`${day.name}, default ${scheduleValueName(activeDefaultValue)}`}
                      >
                        {activePeriods
                          .filter((period) => period.days.includes(day.key))
                          .map((period, index) => {
                            const start = timeMinutes(period.start);
                            const end = timeMinutes(period.end);
                            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
                            const title = `${scheduleValueName(period.value)} · ${period.start}–${period.end}`;
                            return (
                              <span
                                className={`timeline-period preset-${period.value}`}
                                style={{ left: `${(start / 1440) * 100}%`, width: `${((end - start) / 1440) * 100}%` }}
                                title={title}
                                aria-label={title}
                                key={`${period.start}-${period.end}-${index}`}
                              >
                                {end - start >= 180 ? scheduleValueName(period.value) : ""}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="schedule-legend" aria-label="Schedule colours">
                  {activeDefinitions.map((definition) => (
                    <span key={definition.key}>
                      <i className={`preset-${definition.key}`} />{definition.name}
                    </span>
                  ))}
                </div>
              </section>

              <section className="periods-section">
                <div className="section-heading">
                  <div>
                    <h2 className="md-typescale-headline-small">Timed periods</h2>
                  </div>
                  <MdFilledButton type="button" onClick={addPeriod}>Add period</MdFilledButton>
                </div>

                {activePeriods.length === 0 ? (
                  <div className="empty-periods">
                    <strong>No timed periods yet</strong>
                    <span>{scheduleValueName(activeDefaultValue)} will be used all week.</span>
                  </div>
                ) : (
                  <div className="period-list">
                    {activePeriods.map((period, index) => (
                      <article className="period-card" key={index}>
                        <div className="period-title">
                          <h3 className="md-typescale-title-medium">Period {index + 1}</h3>
                          <MdTextButton type="button" onClick={() => removePeriod(index)}>Remove</MdTextButton>
                        </div>
                        <div className="day-picker" aria-label={`Days for period ${index + 1}`}>
                          {WEEKDAYS.map((day) => (
                            <button
                              type="button"
                              className={period.days.includes(day.key) ? "selected" : ""}
                              aria-pressed={period.days.includes(day.key)}
                              onClick={() => togglePeriodDay(index, day.key)}
                              key={day.key}
                            >
                              {day.short}
                            </button>
                          ))}
                        </div>
                        <div className="period-fields">
                          <MdOutlinedTextField
                            required
                            type="time"
                            label="Start"
                            value={period.start}
                            onInput={(event) => updatePeriod(index, { start: eventValue(event) })}
                          />
                          <MdOutlinedTextField
                            required
                            type="time"
                            label="End"
                            value={period.end}
                            onInput={(event) => updatePeriod(index, { end: eventValue(event) })}
                          />
                          <MdOutlinedSelect
                            label={editingHotWater ? "State" : "Preset"}
                            value={period.value}
                            onChange={(event) =>
                              updatePeriod(index, {
                                value: eventValue(event) as PresetKey | HotWaterState,
                              })
                            }
                          >
                            {activeDefinitions.map((definition) => (
                              <MdSelectOption
                                value={definition.key}
                                displayText={definition.name}
                                key={definition.key}
                              >
                                {definition.name}
                              </MdSelectOption>
                            ))}
                          </MdOutlinedSelect>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

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
              <MdFilledButton type="submit" disabled={saving || schedules.length === 0}>
                {saving ? "Saving…" : "Save schedules"}
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

