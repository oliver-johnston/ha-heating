import { useEffect, useId, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { MdMenu, MdMenuItem, MdOutlinedButton } from "./material";

export type HistoryRoom = {
  device_id: string;
  name: string;
  room_group: string;
  climate_entity: string;
};

type HistorySample = {
  observed_at: string;
  device_id: string;
  room_name: string;
  room_group: string;
  available: boolean;
  status: string;
  actual_temperature: number | null;
  external_temperature: number | null;
  trv_temperature: number | null;
  scheduled_temperature: number;
  target_temperature: number;
  commanded_temperature: number;
  reported_target_temperature: number | null;
  preset: string;
  control_source: string;
  demand: boolean;
  boiler_on: boolean | null;
  heating: boolean;
  hvac_action: string | null;
  valve_opening_degree: number | null;
};

type HistoryData = {
  generated_at: string;
  start_at: string;
  end_at: string;
  hours: number;
  bucket_seconds: number;
  rooms: HistoryRoom[];
  samples: HistorySample[];
};

type VisibleSeries = {
  actual: boolean;
  scheduled: boolean;
  effectiveTarget: boolean;
  external: boolean;
  trv: boolean;
  command: boolean;
  heating: boolean;
};

type TemperatureSeriesKey = Exclude<keyof VisibleSeries, "heating">;

const ROOM_COLOURS = [
  "#5b7cfa",
  "#d97706",
  "#0f9d78",
  "#b15dc7",
  "#d94b64",
  "#1687a7",
  "#759532",
  "#875bdb",
];

const SERIES: Array<{ key: TemperatureSeriesKey; label: string }> = [
  { key: "actual", label: "Effective temperature" },
  { key: "scheduled", label: "Scheduled temperature" },
  { key: "effectiveTarget", label: "Effective target" },
  { key: "external", label: "External sensor" },
  { key: "trv", label: "TRV sensor" },
  { key: "command", label: "TRV command" },
];

const SERIES_VALUE: Record<TemperatureSeriesKey, keyof HistorySample> = {
  actual: "actual_temperature",
  scheduled: "scheduled_temperature",
  effectiveTarget: "target_temperature",
  external: "external_temperature",
  trv: "trv_temperature",
  command: "commanded_temperature",
};

const SERIES_DASH: Record<TemperatureSeriesKey, number[] | undefined> = {
  actual: undefined,
  scheduled: [10, 5],
  effectiveTarget: [4, 4],
  external: [2, 5],
  trv: [7, 4],
  command: [3, 3],
};

function temperature(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(1).replace(/\.0$/, "")}°C`;
}

function dateTime(value: number | string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function colourWithAlpha(colour: string, alpha: number) {
  const red = Number.parseInt(colour.slice(1, 3), 16);
  const green = Number.parseInt(colour.slice(3, 5), 16);
  const blue = Number.parseInt(colour.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function MultiSelectMenu({
  label,
  summary,
  options,
  onToggle,
}: {
  label: string;
  summary: string;
  options: Array<{
    id: string;
    label: string;
    selected: boolean;
    colour?: string;
  }>;
  onToggle: (id: string, selected: boolean) => void;
}) {
  const anchorId = `history-${useId().replaceAll(":", "")}`;
  const [open, setOpen] = useState(false);
  return (
    <div className="history-multiselect">
      <MdOutlinedButton
        id={anchorId}
        type="button"
        className="history-multiselect-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="history-multiselect-trigger-content">
          <span>{summary}</span>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="m7 10 5 5 5-5H7Z" />
          </svg>
        </span>
      </MdOutlinedButton>
      <MdMenu
        anchor={anchorId}
        positioning="fixed"
        open={open}
        onClosed={() => setOpen(false)}
      >
        {options.map((option) => (
          <MdMenuItem
            type="option"
            keepOpen
            selected={option.selected}
            key={option.id}
            onClick={() => onToggle(option.id, !option.selected)}
          >
            <span
              slot="start"
              className={`history-menu-check${option.selected ? " selected" : ""}`}
              aria-hidden="true"
            >
              {option.selected ? "✓" : ""}
            </span>
            <span slot="headline" className="history-menu-label">
              {option.colour && (
                <i className="history-room-colour" style={{ background: option.colour }} />
              )}
              {option.label}
            </span>
          </MdMenuItem>
        ))}
      </MdMenu>
    </div>
  );
}

function Chart({
  history,
  visible,
  roomColours,
  onHoverTime,
}: {
  history: HistoryData;
  visible: VisibleSeries;
  roomColours: Map<string, string>;
  onHoverTime: (time: number | null) => void;
}) {
  const plotHost = useRef<HTMLDivElement>(null);

  const chartModel = useMemo(() => {
    const timestamps = [...new Set(history.samples.map((sample) => new Date(sample.observed_at).getTime() / 1000))]
      .sort((left, right) => left - right);
    const timestampIndex = new Map(timestamps.map((timestamp, index) => [timestamp, index]));
    const data: uPlot.AlignedData = [timestamps];
    const series: uPlot.Series[] = [{}];

    history.rooms.forEach((room) => {
      const colour = roomColours.get(room.device_id) ?? ROOM_COLOURS[0];
      const roomSamples = history.samples.filter((sample) => sample.device_id === room.device_id);
      if (visible.heating) {
        const values: Array<number | null> = Array(timestamps.length).fill(null);
        roomSamples.forEach((sample) => {
          if (!sample.heating) return;
          const index = timestampIndex.get(new Date(sample.observed_at).getTime() / 1000);
          if (index != null) values[index] = sample.scheduled_temperature;
        });
        data.push(values);
        series.push({
          label: `${room.name} heating`,
          stroke: colourWithAlpha(colour, 0),
          fill: colourWithAlpha(colour, 0.16),
          fillTo: (plot) => plot.scales.y.min ?? 0,
          width: 0,
          points: { show: false },
          paths: uPlot.paths.stepped!({ align: 1, extend: false }),
        });
      }
      SERIES.filter(({ key }) => visible[key]).forEach(({ key, label }) => {
        const values: Array<number | null> = Array(timestamps.length).fill(null);
        roomSamples.forEach((sample) => {
          const value = sample[SERIES_VALUE[key]];
          const index = timestampIndex.get(new Date(sample.observed_at).getTime() / 1000);
          if (index != null && typeof value === "number") values[index] = value;
        });
        data.push(values);
        series.push({
          label: `${room.name} · ${label}`,
          stroke: colour,
          width: key === "actual" ? 2.5 : key === "scheduled" ? 2.1 : 1.5,
          dash: SERIES_DASH[key],
          alpha: key === "actual" || key === "scheduled" ? 1 : 0.7,
          spanGaps: false,
          points: { show: timestamps.length < 2, size: 7 },
          paths:
            key === "scheduled" || key === "effectiveTarget" || key === "command"
              ? uPlot.paths.stepped!({ align: 1, extend: false })
              : undefined,
        });
      });
    });

    return { data, series };
  }, [history, roomColours, visible]);

  useEffect(() => {
    const host = plotHost.current;
    if (!host || !chartModel.data[0].length) return;
    const computed = getComputedStyle(host);
    const foreground = computed.getPropertyValue("--md-sys-color-on-surface-variant").trim() || "#59545f";
    const grid = computed.getPropertyValue("--md-sys-color-outline-variant").trim() || "#cac4d0";
    const options: uPlot.Options = {
      width: Math.max(320, host.clientWidth),
      height: 420,
      padding: [12, 12, 0, 0],
      legend: { show: false },
      cursor: {
        x: true,
        y: false,
        points: { show: false },
        drag: { x: true, y: false, setScale: true },
      },
      scales: {
        x: { time: true },
        y: {
          range: (_plot, minimum, maximum) => {
            if (minimum == null || maximum == null) return [5, 25];
            const padding = Math.max(0.75, (maximum - minimum) * 0.08);
            return [Math.floor(minimum - padding), Math.ceil(maximum + padding)];
          },
        },
      },
      axes: [
        {
          stroke: foreground,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
        },
        {
          label: "°C",
          labelSize: 18,
          size: 48,
          stroke: foreground,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          values: (_plot, values) => values.map((value) => value.toFixed(0)),
        },
      ],
      series: chartModel.series,
      hooks: {
        setCursor: [
          (plot) => {
            const index = plot.cursor.idx;
            onHoverTime(index == null ? null : Number(plot.data[0][index]) * 1000);
          },
        ],
      },
    };
    const plot = new uPlot(options, chartModel.data, host);
    const observer = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? host.clientWidth);
      if (width > 0 && width !== plot.width) plot.setSize({ width, height: 420 });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      plot.destroy();
      onHoverTime(null);
    };
  }, [chartModel, onHoverTime]);

  return (
    <div
      className="history-plot"
      ref={plotHost}
      role="img"
      aria-label="Temperature history for the selected radiator valves"
    />
  );
}

export function DiagnosticsHistory({
  rooms,
  refreshKey,
}: {
  rooms: HistoryRoom[];
  refreshKey: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    rooms.length ? [rooms[0].device_id] : [],
  );
  const [hours, setHours] = useState(24);
  const [visible, setVisible] = useState<VisibleSeries>({
    actual: true,
    scheduled: true,
    effectiveTarget: false,
    external: false,
    trv: false,
    command: false,
    heating: true,
  });
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  useEffect(() => {
    const available = new Set(rooms.map((room) => room.device_id));
    setSelectedIds((current) => {
      const retained = current.filter((deviceId) => available.has(deviceId));
      return retained.length || !rooms.length ? retained : [rooms[0].device_id];
    });
  }, [rooms]);

  useEffect(() => {
    if (!selectedIds.length) {
      setHistory(null);
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ hours: String(hours) });
    selectedIds.forEach((deviceId) => query.append("device_id", deviceId));
    setLoading(true);
    fetch(`./api/diagnostics/history?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load temperature history");
        return body as HistoryData;
      })
      .then((body) => {
        setHistory(body);
        setError("");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [hours, refreshKey, selectedIds.join("|")]);

  const roomColours = useMemo(
    () => new Map(rooms.map((room, index) => [room.device_id, ROOM_COLOURS[index % ROOM_COLOURS.length]])),
    [rooms],
  );
  const samplesByRoom = useMemo(() => {
    const grouped = new Map<string, HistorySample[]>();
    history?.samples.forEach((sample) => {
      const values = grouped.get(sample.device_id) ?? [];
      values.push(sample);
      grouped.set(sample.device_id, values);
    });
    return grouped;
  }, [history]);
  const hoverRows = useMemo(() => {
    if (hoverTime == null || !history) return [];
    return history.rooms.flatMap((room) => {
      const samples = samplesByRoom.get(room.device_id) ?? [];
      if (!samples.length) return [];
      const nearest = samples.reduce((best, sample) =>
        Math.abs(new Date(sample.observed_at).getTime() - hoverTime) <
        Math.abs(new Date(best.observed_at).getTime() - hoverTime)
          ? sample
          : best,
      );
      return [{ room, sample: nearest }];
    });
  }, [history, hoverTime, samplesByRoom]);

  function toggleRoom(deviceId: string, isChecked: boolean) {
    setSelectedIds((current) =>
      isChecked
        ? [...current, deviceId].filter((value, index, values) => values.indexOf(value) === index)
        : current.filter((value) => value !== deviceId),
    );
  }

  const selectedRoomNames = rooms
    .filter((room) => selectedIds.includes(room.device_id))
    .map((room) => room.name);
  const roomSummary =
    selectedRoomNames.length === rooms.length && rooms.length > 1
      ? `All ${rooms.length} rooms`
      : selectedRoomNames.length === 1
        ? selectedRoomNames[0]
        : selectedRoomNames.length
          ? `${selectedRoomNames.length} rooms`
          : "No rooms";
  const selectedSeriesCount = [...SERIES.map(({ key }) => visible[key]), visible.heating].filter(
    Boolean,
  ).length;

  return (
    <section className="diagnostic-section history-section">
      <header className="diagnostic-section-heading history-heading">
        <div>
          <h2 className="md-typescale-headline-small">Temperature history</h2>
          <p>Compare the effective room temperature with the scheduled target.</p>
        </div>
        {loading && <span className="history-loading">Updating…</span>}
      </header>

      <div className="history-controls">
        <fieldset className="history-control-group history-room-picker">
          <legend>Radiators</legend>
          <MultiSelectMenu
            label="Radiators"
            summary={roomSummary}
            options={rooms.map((room) => ({
              id: room.device_id,
              label: room.name,
              selected: selectedIds.includes(room.device_id),
              colour: roomColours.get(room.device_id),
            }))}
            onToggle={toggleRoom}
          />
        </fieldset>

        <fieldset className="history-control-group">
          <legend>Range</legend>
          <div className="history-segmented-control">
            {[
              [6, "6 hours"],
              [24, "24 hours"],
              [168, "7 days"],
            ].map(([value, label]) => (
              <button
                type="button"
                className={hours === value ? "selected" : ""}
                aria-pressed={hours === value}
                onClick={() => setHours(value as number)}
                key={value}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="history-control-group">
          <legend>Series</legend>
          <MultiSelectMenu
            label="Series"
            summary={`${selectedSeriesCount} selected`}
            options={[
              ...SERIES.map(({ key, label }) => ({
                id: key,
                label,
                selected: visible[key],
              })),
              { id: "heating", label: "Heating periods", selected: visible.heating },
            ]}
            onToggle={(id, selected) =>
              setVisible((current) => ({ ...current, [id]: selected }))
            }
          />
        </fieldset>
      </div>

      {error ? (
        <div className="diagnostic-issue warning history-error" role="alert">
          <div>
            <strong>Temperature history is unavailable</strong>
            <p>{error}</p>
          </div>
        </div>
      ) : !selectedIds.length ? (
        <p className="diagnostic-empty">Select at least one radiator valve.</p>
      ) : history && history.samples.length ? (
        <div className="history-visual">
          <Chart
            history={history}
            visible={visible}
            roomColours={roomColours}
            onHoverTime={setHoverTime}
          />
          <div className="history-legends">
            <div className="history-room-legend">
              {history.rooms.map((room) => (
                <span key={room.device_id}>
                  <i style={{ background: roomColours.get(room.device_id) }} />
                  {room.name}
                </span>
              ))}
            </div>
            <div className="history-series-legend">
              {SERIES.filter(({ key }) => visible[key]).map(({ key, label }) => (
                <span key={key} className={`history-legend-${key}`}><i />{label}</span>
              ))}
              {visible.heating && <span className="history-legend-heating"><i />Heating</span>}
            </div>
          </div>

          {hoverTime != null && hoverRows.length > 0 && (
            <div className="history-inspector" aria-live="polite">
              <strong>{dateTime(hoverTime)}</strong>
              <div>
                {hoverRows.map(({ room, sample }) => (
                  <article key={room.device_id}>
                    <header>
                      <i style={{ background: roomColours.get(room.device_id) }} />
                      <strong>{room.name}</strong>
                      <span>{sample.heating ? "Heating" : sample.demand ? "Waiting for heating" : "Satisfied"}</span>
                    </header>
                    <dl>
                      <div><dt>Effective</dt><dd>{temperature(sample.actual_temperature)}</dd></div>
                      <div><dt>Scheduled</dt><dd>{temperature(sample.scheduled_temperature)}</dd></div>
                      <div><dt>Effective target</dt><dd>{temperature(sample.target_temperature)}</dd></div>
                      <div><dt>External</dt><dd>{temperature(sample.external_temperature)}</dd></div>
                      <div><dt>TRV</dt><dd>{temperature(sample.trv_temperature)}</dd></div>
                      <div><dt>Command</dt><dd>{temperature(sample.commanded_temperature)}</dd></div>
                      <div><dt>Boiler</dt><dd>{sample.boiler_on == null ? "—" : sample.boiler_on ? "On" : "Off"}</dd></div>
                      <div><dt>Valve</dt><dd>{sample.valve_opening_degree == null ? "—" : `${sample.valve_opening_degree}%`}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : history && !history.samples.length ? (
        <p className="diagnostic-empty">No samples have been recorded for this period yet.</p>
      ) : (
        <div className="history-placeholder">Loading temperature history…</div>
      )}
    </section>
  );
}
