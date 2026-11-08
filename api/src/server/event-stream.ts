/** Server-sent events for one run's event log: the backlog after a cursor, then appends as they happen, then `end`. */
import type { ServerResponse } from 'node:http';
import { isTerminalRun, type RunStatus } from '@sidechannel/contracts/harness/contracts';
import type { EventQuery } from '@sidechannel/contracts/harness/repository';
import type { ResearcherRepository } from '@sidechannel/contracts/server/contracts';
import { HttpError } from './errors.js';
import { cursor } from './http.js';

export interface EventStreamTiming {
    /** Re-query interval when no change notification arrives (also the whole mechanism on a standalone Mongo). */
    pollMs: number;
    /** Comment-frame interval; Cloudflare closes idle connections after about 100 s. */
    heartbeatMs: number;
}
export const DEFAULT_EVENT_STREAM_TIMING: EventStreamTiming = { pollMs: 2000, heartbeatMs: 15000 };

export type EventStreamSource = Pick<ResearcherRepository, 'queryEvents' | 'getRunSummary' | 'subscribeEvents'>;
export type StreamQuery = Pick<EventQuery, 'after' | 'actor' | 'phase' | 'type' | 'from'>;

const STREAM = /^\/runs\/([^/]+)\/events\/stream$/;
const BATCH = 200;

/**
 * Raw-write seam. The transport-neutral router contract only returns JSON results, so the live stream is
 * matched by the server *before* JSON dispatch and handed straight to `streamRunEvents`, which owns the
 * response. This is the single exception: no router ever writes to the response itself.
 */
export interface EventStreamRoute {
    readonly runId: string;
    readonly query: StreamQuery;
}

/** Resolves `GET /runs/:id/events/stream`; returns null for every other route and throws the documented 4xx payloads. */
export async function eventStreamRoute(source: EventStreamSource, path: string, query: URLSearchParams, lastEventId: string | undefined): Promise<EventStreamRoute | null> {
    const match = path.match(STREAM);
    if (!match) return null;
    const runId = decodeURIComponent(match[1]!);
    if (!await source.getRunSummary(runId)) throw new HttpError(404, 'Run not found');
    if (query.has('to') || query.has('before')) throw new HttpError(400, 'A live stream has no upper sequence bound; use the paged events endpoint');
    if (query.has('phase') && !['action', 'report'].includes(query.get('phase')!)) throw new HttpError(400, 'phase must be action or report');
    const resume = lastEventId ? lastEventId : query.get('after');
    return {
        runId,
        query: {
            after: cursor(resume ?? null, 0),
            ...(query.get('actor') ? { actor: query.get('actor')! } : {}),
            ...(query.get('phase') ? { phase: query.get('phase')! } : {}),
            ...(query.get('type') ? { type: query.get('type')! } : {}),
            ...(query.has('from') ? { from: cursor(query.get('from'), 0) } : {}),
        },
    };
}

async function frame(res: ServerResponse, event: string, data: unknown, id?: number) {
    if (res.destroyed) return;
    const flushed = res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (!flushed) await new Promise<void>(resolve => { const done = () => { res.off('drain', done); res.off('close', done); resolve(); }; res.once('drain', done); res.once('close', done); });
}

/**
 * Every event is read through `queryEvents(after: cursor)`. `subscribeEvents` only wakes the loop early, so
 * there is no race between the backlog and new events, and nothing is lost if notifications are unavailable.
 * The run's status is checked whenever the backlog is drained; once it is terminal the loop drains once more
 * (events written just before the status change) and then sends `end`.
 */
export async function streamRunEvents(res: ServerResponse, repository: EventStreamSource, runId: string, query: StreamQuery, timing: EventStreamTiming = DEFAULT_EVENT_STREAM_TIMING): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    let closed = false, pending = false;
    let wake: (() => void) | undefined;
    const nudge = () => { if (wake) { const resolve = wake; wake = undefined; resolve(); } else pending = true; };
    const onClose = () => { closed = true; nudge(); };
    res.on('close', onClose);
    const unsubscribe = repository.subscribeEvents?.(runId, nudge);
    const heartbeat = setInterval(() => { if (!closed && !res.destroyed) res.write(': ping\n\n'); }, timing.heartbeatMs);
    let after = query.after ?? 0;
    let finishing: RunStatus | 'missing' | undefined;
    try {
        while (!closed) {
            pending = false;
            const rows = await repository.queryEvents(runId, { ...query, after, limit: BATCH });
            for (const event of rows) { if (closed) break; await frame(res, 'harness_event', event, event.sequence); after = event.sequence; }
            if (rows.length === BATCH) continue;
            if (finishing) { await frame(res, 'end', { status: finishing }); break; }
            const summary = await repository.getRunSummary(runId);
            if (!summary || isTerminalRun(summary.status)) { finishing = summary?.status ?? 'missing'; continue; }
            if (pending) continue;
            await new Promise<void>(resolve => {
                const timer = setTimeout(() => { wake = undefined; resolve(); }, timing.pollMs);
                wake = () => { clearTimeout(timer); resolve(); };
            });
        }
    } catch (error) {
        await frame(res, 'stream_error', { error: error instanceof Error ? error.message : 'Event stream failed' }).catch(() => undefined);
    } finally {
        clearInterval(heartbeat);
        unsubscribe?.();
        res.off('close', onClose);
        if (!res.destroyed) res.end();
    }
}
