import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useClients } from "../../lib/clients/context";
import { useResource, useResourcePage } from "../../lib/clients/query";
import type { AnalysisWindow, WindowDetail } from "../../lib/analysis-types";

/**
 * The window page, the display-only threshold/filter state and the selected window detail.
 * Every read is keyed by the analysis id, so a route change drops stale windows.
 */
export function useAnalysisWindows(id: string | undefined) {
  const clients = useClients();
  const [params, setParams] = useSearchParams();
  const [threshold, setThreshold] = useState(0.7);
  const [visible, setVisible] = useState<string[]>();
  const pages = useResourcePage<AnalysisWindow>(
    id ? `analysis:${id}:windows` : null,
    (cursor) =>
      clients.analyses.windows(id!, { limit: 30, after: cursor ?? undefined }),
    { interval: 6000 },
  );
  const windowId = params.get("window");
  const detail = useResource<WindowDetail>(
    id && windowId ? `analysis:${id}:window:${windowId}` : null,
    () => clients.analyses.window(id!, windowId!),
  );
  const open = (next: string) =>
    setParams((prev) => {
      prev.set("window", next);
      return prev;
    });
  const close = () =>
    setParams((prev) => {
      prev.delete("window");
      return prev;
    });
  return {
    windows: pages.data,
    page: pages.page,
    hasMore: pages.hasMore,
    onChange: pages.onChange,
    loading: pages.loading,
    error: pages.error,
    refresh: pages.refresh,
    threshold,
    setThreshold,
    visible,
    setVisible,
    windowId,
    detail: detail.data,
    detailLoading: detail.loading,
    detailError: detail.error,
    refreshDetail: detail.refresh,
    open,
    close,
  };
}
