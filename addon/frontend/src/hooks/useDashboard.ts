import { useCallback, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import type { DashboardData } from "../types";
import { usePolling } from "./usePolling";

export function useDashboard(active: boolean, reportError: (message: string) => void) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const reportErrorRef = useRef(reportError);
  reportErrorRef.current = reportError;

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiRequest<DashboardData>(
        "dashboard",
        undefined,
        "Could not load the dashboard",
      );
      setDashboard(data);
      reportErrorRef.current("");
    } catch (reason) {
      reportErrorRef.current(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  usePolling(active, () => void refresh(true));
  return { dashboard, loading, refresh };
}
