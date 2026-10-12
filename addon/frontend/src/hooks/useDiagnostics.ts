import { useCallback, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import type { DiagnosticsData } from "../types";
import { usePolling } from "./usePolling";

export function useDiagnostics(active: boolean, reportError: (message: string) => void) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const reportErrorRef = useRef(reportError);
  reportErrorRef.current = reportError;

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiRequest<DiagnosticsData>(
        "diagnostics",
        undefined,
        "Could not load diagnostics",
      );
      setDiagnostics(data);
      reportErrorRef.current("");
    } catch (reason) {
      reportErrorRef.current(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  usePolling(active, () => void refresh(true));
  return { diagnostics, loading, refresh };
}
