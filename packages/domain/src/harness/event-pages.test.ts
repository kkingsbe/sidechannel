import test from 'node:test';
import assert from 'node:assert/strict';
import type { HarnessEvent } from '@sidechannel/contracts/harness/contracts';
import { matchesEventQuery, snapBackward, snapForward, summarizeTurns, turnKey } from './event-pages.js';

let sequence = 0;
const event = (extra: Partial<HarnessEvent> = {}): HarnessEvent => ({ schemaVersion: 1, id: `e${++sequence}`, runId: 'run', sequence, type: 'step', timestamp: '2026-11-07T00:00:00.000Z', data: {}, ...extra });

/** seq 1 run-level; turn 1 (alpha) = 2–4; turn 2 (beta) = 5–7; turn 3 (alpha) = 8–10. */
function log(): HarnessEvent[] {
    sequence = 0;
    return [event(), ...[1, 2, 3].flatMap(turn => [0, 1, 2].map(index => event({
        agentId: turn === 2 ? 'beta' : 'alpha', round: 1, turn, invocationId: `inv-${turn}`,
        type: index === 0 ? 'model_requested' : index === 2 ? 'tool_failed' : 'step',
    })))];
}
const seqs = (events: HarnessEvent[]) => events.map(e => e.sequence);

test('turn keys match the dashboard grouping and leave run-level events ungrouped', () => {
    const [runLevel, first] = log();
    assert.equal(turnKey(runLevel!), null);
    assert.equal(turnKey(first!), 'alpha|1|1');
    assert.equal(turnKey({ agentId: 'alpha', turn: 0 }), null);
});

test('forward pages extend to the end of the turn the limit would cut', () => {
    assert.deepEqual(seqs(snapForward(log(), 2).events), [1, 2, 3, 4]);
    assert.equal(snapForward(log(), 2).hasMore, true);
    assert.deepEqual(seqs(snapForward(log(), 1).events), [1], 'run-level events never extend a page');
    assert.deepEqual(seqs(snapForward(log(), 2, 1).events), [1, 2, 3], 'slack caps an oversized turn');
    assert.deepEqual(snapForward(log(), 100), { events: log(), hasMore: false });
});

test('backward pages take newest-first rows, extend to the turn start and return oldest first', () => {
    const page = snapBackward([...log()].reverse(), 1);
    assert.deepEqual(seqs(page.events), [8, 9, 10]);
    assert.equal(page.hasMore, true);
});

test('event matching honours exclusive bounds and the report phase', () => {
    const [runLevel, first] = log();
    assert.equal(matchesEventQuery(first!, { before: 2 }), false);
    assert.equal(matchesEventQuery(first!, { before: 3, after: 1 }), true);
    assert.equal(matchesEventQuery({ ...runLevel!, invocationId: 'run:report:alpha' }, { phase: 'report' }), true);
    assert.equal(matchesEventQuery(first!, { phase: 'report' }), false);
});

test('turn summaries count events, distinct model calls and failures per turn', () => {
    assert.deepEqual(summarizeTurns(log()), [
        { agentId: 'alpha', round: 1, turn: 1, firstSequence: 2, lastSequence: 4, eventCount: 3, modelCalls: 1, failures: 1 },
        { agentId: 'beta', round: 1, turn: 2, firstSequence: 5, lastSequence: 7, eventCount: 3, modelCalls: 1, failures: 1 },
        { agentId: 'alpha', round: 1, turn: 3, firstSequence: 8, lastSequence: 10, eventCount: 3, modelCalls: 1, failures: 1 },
    ]);
});
