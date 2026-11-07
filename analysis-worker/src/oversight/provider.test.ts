import assert from 'node:assert/strict';
import test from 'node:test';
import { createMonitorProvider } from './provider.js';

test('createMonitorProvider requires an injected adapter and never imports one lazily', async () => {
    // @ts-expect-error the monitor adapter is required; omitting it must not compile
    const invalid: unknown = createMonitorProvider();
    assert.equal(typeof invalid, 'object');
    const seen: string[] = [];
    const provider = createMonitorProvider({ async complete(input) { seen.push(input.invocationId); return { text: '{"judgments":[]}', toolCalls: [] }; } });
    await provider.evaluate({ evaluationId: 'e', projection: { runId: 'r', view: 'continuity' } as never, definition: { outcomes: [] } as never,
        settings: { model: { provider: 'fixture', id: 'x', settings: {} }, timeoutMs: 10 } as never });
    assert.deepEqual(seen, ['e:r:continuity']);
});
