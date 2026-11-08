import { createContext, createElement, useContext, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { AnalysisWindow, WindowDetail } from "../../lib/analysis-types";

/** Display-only score filters shared by every analysis view so a tab change keeps them. */
interface ScoreFilters {
  threshold: number;
  setThreshold(value: number): void;
  visible: string[] | undefined;
  setVisible(value: string[] | undefined): void;
}
const ScoreFiltersContext = createContext<ScoreFilters | null>(null);

export function ScoreFiltersProvider({ children }: { children: ReactNode }) {
  const [threshold, setThreshold] = useState(0.7);
  const [visible, setVisible] = useState<string[]>();
  return createElement(
    ScoreFiltersContext.Provider,
    { value: { threshold, setThreshold, visible, setVisible } },
    children,
  );
}

const PAGE = 200;
const MAX_PAGES = 25;

/**
 * Every window of the analysis (the views chart the whole run, so they follow the cursor to the
 * end), the display-only threshold/filter state and the selected window detail.
 * Every read is keyed by the analysis id, so a route change drops stale windows.
 */
export function useAnalysisWindows(id: string | undefined) {
  const clients = useClients();
  const [params, setParams] = useSearchParams();
  const shared = useContext(ScoreFiltersContext);
  const [localThreshold, setLocalThreshold] = useState(0.7);
  const [localVisible, setLocalVisible] = useState<string[]>();
  const threshold = shared ? shared.threshold : localThreshold;
  const setThreshold = shared ? shared.setThreshold : setLocalThreshold;
  const visible = shared ? shared.visible : localVisible;
  const setVisible = shared ? shared.setVisible : setLocalVisible;
  const all = useResource<AnalysisWindow[]>(
    id ? `analysis:${id}:windows` : null,
    async () => {
      const items: AnalysisWindow[] = [];
      let after: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await clients.analyses.windows(id!, { limit: PAGE, after });
        items.push(...result.items);
        if (!result.nextCursor) break;
        after = result.nextCursor;
      }
      return items;
    },
    { interval: 6000 },
  );
  const windowId = params.get("window");
  const detail = useResource<WindowDetail>(
    id && windowId ? `analysis:${id}:window:${windowId}` : null,
    () => clients.analyses.window(id!, windowId!),
  );
  /** Opens a window; a heatmap click also records the behavior so the inspector leads with it. */
  const open = (next: string, codeId?: string) =>
    setParams((prev) => {
      prev.set("window", next);
      if (codeId) prev.set("code", codeId);
      else prev.delete("code");
      return prev;
    });
  /** Records the behavior picked inside the inspector without adding a history entry. */
  const setCode = (codeId: string) =>
    setParams(
      (prev) => {
        prev.set("code", codeId);
        return prev;
      },
      { replace: true },
    );
  const close = () =>
    setParams((prev) => {
      prev.delete("window");
      prev.delete("code");
      return prev;
    });
  return {
    windows: all.data ?? EMPTY,
    loading: all.loading,
    error: all.error,
    refresh: all.refresh,
    threshold,
    setThreshold,
    visible,
    setVisible,
    windowId,
    codeId: params.get("code"),
    setCode,
    detail: detail.data,
    detailLoading: detail.loading,
    detailError: detail.error,
    refreshDetail: detail.refresh,
    open,
    close,
  };
}
const EMPTY: AnalysisWindow[] = [];
