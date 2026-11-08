/**
 * One gap-free window of a run's events, loaded in whole turns (`snap=turn`), that can follow new
 * events over server-sent events with a polling fallback. Replaces the timeline's page/cursor state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { useRequester } from './api';
import { appendLater, emptyWindow, prependEarlier, type EventWindow } from './event-window';

/** `before` value meaning "from the newest event". */
export const LATEST_SEQUENCE = Number.MAX_SAFE_INTEGER;
export const EVENT_PAGE_SIZE = 50;
const FLUSH_MS = 250;
const POLL_MS = 3000;
const MAX_STREAM_ERRORS = 3;

export interface EventFilters { actor?: string; phase?: string; type?: string; from?: string; to?: string }
/** Where the window starts: the run's first event, its newest turn, or the given sequence. */
export type EventStart = 'first' | 'latest' | number;
export type StreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'ended';

export interface RunEvents extends EventWindow {
  loading: boolean;
  error: Error | undefined;
  status: StreamStatus;
  /** Each resolves to the number of events the page returned. */
  loadEarlier: () => Promise<number>;
  loadLater: () => Promise<number>;
  reload: () => void;
}

interface EventPage { events?: HarnessEvent[]; hasMore?: boolean }

export function filterQuery(filters: EventFilters): string {
  const query = new URLSearchParams();
  for (const name of ['actor', 'phase', 'type', 'from', 'to'] as const) if (filters[name]) query.set(name, filters[name]!);
  return query.toString();
}

export function useRunEvents(runId: string | undefined, filters: EventFilters, options: { start: EventStart; follow: boolean; enabled: boolean }): RunEvents {
  const { start, follow, enabled } = options;
  const requester = useRequester();
  const filterString = filterQuery(filters);
  const [nonce, setNonce] = useState(0);
  const key = runId && enabled ? `${runId}?${filterString}@${start}#${nonce}` : null;
  const [win, setWin] = useState<EventWindow>(emptyWindow);
  const [loading, setLoading] = useState(!!key);
  const [loadError, setLoadError] = useState<Error>();
  const [pageError, setPageError] = useState<Error>();
  const [status, setStatus] = useState<StreamStatus>('idle');
  /** The key whose initial window is in `win`; the stream opens only for it, never from a stale window. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const windowRef = useRef(win);
  windowRef.current = win;
  const generation = useRef(0);

  const fetchPage = useCallback(async (params: Record<string, string>) => {
    const query = new URLSearchParams(filterString);
    query.set('snap', 'turn');
    query.set('limit', String(EVENT_PAGE_SIZE));
    for (const [name, value] of Object.entries(params)) query.set(name, value);
    const page = await requester<EventPage>(`/runs/${encodeURIComponent(runId ?? '')}/events?${query}`);
    return { events: page.events ?? [], hasMore: !!page.hasMore };
  }, [requester, runId, filterString]);

  // Initial window: re-runs whenever the run, filters, start or reload nonce change (all encoded in `key`).
  useEffect(() => {
    const current = ++generation.current;
    setWin(emptyWindow); setLoadError(undefined); setPageError(undefined); setStatus('idle');
    if (!key) { setLoading(false); return; }
    setLoading(true);
    const initial = start === 'latest'
      ? fetchPage({ before: String(LATEST_SEQUENCE) }).then(page => ({ events: page.events, hasEarlier: page.hasMore, hasLater: false }))
      : start === 'first'
        ? fetchPage({ after: '0' }).then(page => ({ events: page.events, hasEarlier: false, hasLater: page.hasMore }))
        : fetchPage({ after: String(start - 1) }).then(page => ({ events: page.events, hasEarlier: start > 1, hasLater: page.hasMore }));
    initial
      .then(next => { if (current === generation.current) { setWin(next); setLoadedKey(key); } }, (error: unknown) => { if (current === generation.current) setLoadError(error as Error); })
      .finally(() => { if (current === generation.current) setLoading(false); });
  }, [key, fetchPage, start]);

  // Once the caller stops following (run finished, or the reader jumped elsewhere), a stream that was running reads as ended.
  useEffect(() => { if (!follow) setStatus(previous => (previous === 'idle' ? previous : 'ended')); }, [follow]);

  const following = !!key && key === loadedKey && follow && !loading && !loadError;
  useEffect(() => {
    if (!following) return;
    const current = generation.current;
    let buffer: HarnessEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let source: EventSource | undefined;
    let errors = 0;
    const newest = () => Math.max(windowRef.current.events.at(-1)?.sequence ?? 0, ...buffer.map(event => event.sequence));
    const flush = () => {
      flushTimer = undefined;
      if (current !== generation.current || !buffer.length) return;
      const batch = buffer;
      buffer = [];
      setWin(w => appendLater(w, batch, false));
    };
    // Model calls write four events in a burst; batching keeps TimelinePanel from rebuilding per event.
    const push = (events: HarnessEvent[]) => { if (!events.length) return; buffer.push(...events); flushTimer ??= setTimeout(flush, FLUSH_MS); };
    const poll = () => {
      setStatus('polling');
      pollTimer = setInterval(() => { fetchPage({ after: String(newest()) }).then(page => push(page.events), () => undefined); }, POLL_MS);
    };
    if (typeof EventSource === 'undefined') poll();
    else {
      const query = new URLSearchParams(filterString);
      query.set('after', String(newest()));
      source = new EventSource(`/api/runs/${encodeURIComponent(runId ?? '')}/events/stream?${query}`);
      setStatus('connecting');
      source.onopen = () => { errors = 0; setStatus('live'); };
      source.addEventListener('harness_event', message => push([JSON.parse((message as MessageEvent<string>).data) as HarnessEvent]));
      source.addEventListener('end', () => { source?.close(); flush(); setStatus('ended'); });
      source.onerror = () => {
        if (!source) return;
        if (source.readyState === EventSource.CLOSED || ++errors >= MAX_STREAM_ERRORS) { source.close(); source = undefined; poll(); }
        else setStatus('reconnecting');
      };
    }
    return () => { source?.close(); clearInterval(pollTimer); if (flushTimer) clearTimeout(flushTimer); };
  }, [following, filterString, runId, fetchPage]);

  const loadEarlier = useCallback(async () => {
    const first = windowRef.current.events[0];
    if (!first || !key) return 0;
    const current = generation.current;
    try {
      const page = await fetchPage({ before: String(first.sequence) });
      if (current !== generation.current) return 0;
      setPageError(undefined);
      // While following, never evict the live end.
      setWin(w => prependEarlier(w, page.events, page.hasMore, follow ? Number.POSITIVE_INFINITY : undefined));
      return page.events.length;
    } catch (error) { if (current === generation.current) setPageError(error as Error); return 0; }
  }, [key, fetchPage, follow]);

  const loadLater = useCallback(async () => {
    const last = windowRef.current.events.at(-1);
    if (!last || !key) return 0;
    const current = generation.current;
    try {
      const page = await fetchPage({ after: String(last.sequence) });
      if (current !== generation.current) return 0;
      setPageError(undefined);
      setWin(w => appendLater(w, page.events, page.hasMore));
      return page.events.length;
    } catch (error) { if (current === generation.current) setPageError(error as Error); return 0; }
  }, [key, fetchPage]);

  const reload = useCallback(() => setNonce(n => n + 1), []);
  return { ...win, loading, error: loadError ?? pageError, status, loadEarlier, loadLater, reload };
}
