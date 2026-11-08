import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { HarnessEvent } from "../../lib/types";

const PAGE = 1000;
const MAX_PAGES = 10;

export const EVENT_PAGE_SIZE = 50;

/** Highest recorded event sequence, found with a few one-row probes (no reverse paging exists). */
export async function findLatestSequence(runId: string): Promise<number> {
  const hasAfter = async (after: number) => {
    const result = await api<{ events?: unknown[] }>(
      `/runs/${encodeURIComponent(runId)}/events?limit=1&after=${after}`,
    );
    return Array.isArray(result?.events) && result.events.length > 0;
  };
  if (!(await hasAfter(0))) return 0;
  let low = 0;
  let high = 1;
  while (await hasAfter(high)) {
    low = high;
    high *= 2;
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (await hasAfter(mid)) low = mid;
    else high = mid;
  }
  return high;
}

export interface RunEventsByType {
  events: Record<string, HarnessEvent[]>;
  loading: boolean;
  error?: Error;
  /** True when at least one type hit the page cap, so counts are lower bounds. */
  partial: boolean;
}

async function fetchAll(runId: string, type: string) {
  const events: HarnessEvent[] = [];
  let after = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await api<{
      events?: HarnessEvent[];
      nextCursor?: number;
      hasMore?: boolean;
    }>(
      `/runs/${encodeURIComponent(runId)}/events?type=${encodeURIComponent(type)}&limit=${PAGE}&after=${after}`,
    );
    const rows = Array.isArray(result?.events) ? result.events : [];
    events.push(...rows);
    if (!result?.hasMore || !rows.length) return { events, partial: false };
    after = result.nextCursor ?? rows[rows.length - 1]!.sequence;
  }
  return { events, partial: true };
}

/** Fetches every recorded event of the given types (paged), optionally refreshing while a run is active. */
export function useRunEventsByType(
  runId: string | undefined,
  types: string[],
  enabled: boolean,
  refreshMs = 0,
): RunEventsByType {
  const [state, setState] = useState<RunEventsByType>({
    events: {},
    loading: enabled,
    partial: false,
  });
  const key = types.join(",");
  useEffect(() => {
    if (!enabled || !runId) {
      setState({ events: {}, loading: false, partial: false });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    const load = async () => {
      try {
        const results = await Promise.all(
          types.map((type) => fetchAll(runId, type)),
        );
        if (cancelled) return;
        setState({
          events: Object.fromEntries(
            types.map((type, index) => [type, results[index]!.events]),
          ),
          loading: false,
          partial: results.some((result) => result.partial),
        });
      } catch (error) {
        if (!cancelled)
          setState((previous) => ({
            ...previous,
            loading: false,
            error: error as Error,
          }));
      }
    };
    void load();
    const timer = refreshMs
      ? setInterval(() => !document.hidden && void load(), refreshMs)
      : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, enabled, key, refreshMs]);
  return state;
}
