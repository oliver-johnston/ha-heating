export type PresetIconKey = "boost" | "comfort" | "eco" | "frost";

const PRESET_LABELS: Record<PresetIconKey, string> = {
  boost: "Boost",
  comfort: "Comfort",
  eco: "Eco",
  frost: "Frost",
};

const PRESET_ICON_PATHS: Record<PresetIconKey, string> = {
  eco: "M17 8C8 10 5.9 16.2 3 22c2.9-4.1 6.1-6 10-6 6 0 7-11 7-11-1 2-7 2-10 2-4 0-7 3-7 7 0 1 0 2 .5 3C8 10 12 8 17 8Z",
  comfort: "M21 10c-1.1 0-2 .9-2 2v3H5v-3c0-1.1-.9-2-2-2s-2 .9-2 2v5c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2v-5c0-1.1-.9-2-2-2Zm-3-5H6c-1.1 0-2 .9-2 2v2.15c1.16.41 2 1.52 2 2.85v2h12v-2c0-1.33.84-2.44 2-2.85V7c0-1.1-.9-2-2-2Z",
  boost: "M12 22c4.42 0 8-3.58 8-8 0-3.54-2.29-6.53-5.47-7.59L14 6.24V2l-1.09.66C9.32 4.86 7 8.82 7 13.5c0 .28.02.55.05.82C6.38 13.49 6 12.44 6 11.3V9.6l-1.5 1.15C2.93 11.96 2 13.88 2 16c0 3.31 2.69 6 6 6h4Z",
  frost: "M22 11h-4.17l3.24-3.24-1.42-1.42L15 11h-2V9l4.66-4.66-1.42-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.42L9 13h2v2l-4.66 4.66 1.42 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.42-1.41L13 15v-2h2l4.65 4.66 1.42-1.42L17.83 13H22v-2Z",
};

export function PresetIcon({ preset }: { preset: PresetIconKey }) {
  const label = PRESET_LABELS[preset];
  return (
    <span className={`preset-icon preset-${preset}`} title={label}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d={PRESET_ICON_PATHS[preset]} />
      </svg>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
