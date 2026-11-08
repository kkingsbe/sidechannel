/** Pure helpers for paging, filtering and indexing a run's event log by agent turn. No I/O. */
import type { HarnessEvent } from '@sidechannel/contracts/harness/contracts';
import type { EventQuery, TurnSummary } from '@sidechannel/contracts/harness/repository';

/** Extra events a turn-snapped page may take beyond `limit` so it does not cut a turn in half. */
export const TURN_SNAP_SLACK = 400;

const FAILURE = /denied|error|fail/;

/** Same grouping as the dashboard timeline: one key per agent turn; run-level events have none. */
export function turnKey(event: Pick<HarnessEvent, 'agentId' | 'round' | 'turn'>): string | null {
    return !event.turn || !event.agentId ? null : `${event.agentId}|${event.round ?? ''}|${event.turn}`;
}

export interface SnappedPage { events: HarnessEvent[]; hasMore: boolean }

/**
 * `rows` are in request order and were fetched with `limit + slack + 1`. Keeps `limit` rows, then keeps
 * taking rows of the same turn as the last kept row, up to `limit + slack`. Run-level events never extend.
 */
function snap(rows: HarnessEvent[], limit: number, slack: number): SnappedPage {
    let end = Math.min(limit, rows.length);
    const key = end > 0 ? turnKey(rows[end - 1]!) : null;
    while (key !== null && end < rows.length && end < limit + slack && turnKey(rows[end]!) === key) end++;
    return { events: rows.slice(0, end), hasMore: rows.length > end };
}

/** `rows` are oldest first. */
export function snapForward(rows: HarnessEvent[], limit: number, slack = TURN_SNAP_SLACK): SnappedPage {
    return snap(rows, limit, slack);
}

/** `rowsDesc` are newest first; the returned events are oldest first. */
export function snapBackward(rowsDesc: HarnessEvent[], limit: number, slack = TURN_SNAP_SLACK): SnappedPage {
    const page = snap(rowsDesc, limit, slack);
    return { events: [...page.events].reverse(), hasMore: page.hasMore };
}

/**
 * Report-first phase classification: a declared `report` phase, a `report*` event type or a `:report:`
 * invocation id all classify as `report`. This is the WS1 parity rule the Mongo adapter's `$or` filter
 * encodes; main's helper preferred a declared `action` over the event type, which made the memory and
 * Mongo adapters disagree for a report event that carried a stale declared phase.
 */
export function eventPhase(event: HarnessEvent): string {
    const declared = (event.data as { phase?: string } | null)?.phase;
    if (declared === 'report' || event.type.startsWith('report') || event.invocationId?.includes(':report:'))
        return 'report';
    return declared ?? 'action';
}

export function matchesEventQuery(event: HarnessEvent, query: EventQuery): boolean {
    return event.sequence > (query.after ?? 0)
        && (query.before === undefined || event.sequence < query.before)
        && (!query.actor || event.agentId === query.actor)
        && (!query.type || event.type === query.type)
        && (!query.phase || eventPhase(event) === query.phase)
        && (query.from === undefined || event.sequence >= query.from)
        && (query.to === undefined || event.sequence <= query.to);
}

/** Turns in first-sequence order. A model call is a distinct `invocationId` on a `model_requested` event. */
export function summarizeTurns(events: readonly HarnessEvent[]): TurnSummary[] {
    const turns = new Map<string, TurnSummary & { calls: Set<string> }>();
    for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
        const key = turnKey(event);
        if (key === null) continue;
        let turn = turns.get(key);
        if (!turn) {
            turn = { agentId: event.agentId!, ...(event.round === undefined ? {} : { round: event.round }), turn: event.turn!, firstSequence: event.sequence, lastSequence: event.sequence, eventCount: 0, modelCalls: 0, failures: 0, calls: new Set() };
            turns.set(key, turn);
        }
        turn.lastSequence = event.sequence;
        turn.eventCount++;
        if (event.type === 'model_requested' && event.invocationId) turn.calls.add(event.invocationId);
        if (FAILURE.test(event.type)) turn.failures++;
    }
    return [...turns.values()].map(({ calls, ...turn }) => ({ ...turn, modelCalls: calls.size }));
}
