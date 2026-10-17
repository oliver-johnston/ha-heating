import { MdFilledButton, MdTextButton } from "../material";

type Props = {
  roomCount: number;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
  busy?: boolean;
};

export function PredictiveHeatingBanner({
  roomCount,
  actionLabel,
  onAction,
  onDismiss,
  busy = false,
}: Props) {
  const rooms = roomCount === 1 ? "1 room" : `${roomCount} rooms`;

  return (
    <section className="predictive-availability-banner" role="status">
      <div>
        <strong>Predictive preheating is available in {rooms}</strong>
        <p>
          Heat Steward has learned enough to warm these rooms on time and close their
          valves early.
        </p>
      </div>
      <div className="predictive-availability-actions">
        <MdFilledButton type="button" disabled={busy} onClick={onAction}>
          {busy ? "Turning on…" : actionLabel}
        </MdFilledButton>
        <MdTextButton type="button" disabled={busy} onClick={onDismiss}>
          Dismiss
        </MdTextButton>
      </div>
    </section>
  );
}
