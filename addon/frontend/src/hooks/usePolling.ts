import { useEffect, useRef } from "react";

export function usePolling(active: boolean, refresh: () => void, intervalMs = 30_000) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => refreshRef.current(), intervalMs);
    return () => window.clearInterval(interval);
  }, [active, intervalMs]);
}
