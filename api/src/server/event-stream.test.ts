import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createResearcherServer } from './index.js';

interface Frame { event: string; id?: string; data?: unknown }

function sseReader(response: Response) {
    const reader = response.body!.getReader(), decoder = new TextDecoder(), frames: Frame[] = [];
    let buffer = '';
    const until = async (done: (all: Frame[]) => boolean, timeoutMs = 3000) => {
        const deadline = Date.now() + timeoutMs;
        while (!done(frames)) {
            if (Date.now() > deadline) throw new Error('SSE timeout; frames so far: ' + JSON.stringify(frames));
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
                const frame: Frame = { event: 'message' };
                for (const line of buffer.slice(0, end).split('\n')) {
                    if (line.startsWith(':')) frame.event = 'comment';
                    else if (line.startsWith('event: ')) frame.event = line.slice(7);
                    else if (line.startsWith('id: ')) frame.id = line.slice(4);
                    else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6));
                }
                buffer = buffer.slice(end + 2);
                frames.push(frame);
            }
        }
        return frames;
    };
    return { until };
}
const harness = (frames: Frame[]) => frames.filter(frame => frame.event === 'harness_event');

test('the event stream replays the backlog, follows appends, sends heartbeats, resumes from Last-Event-ID and ends with the run', async () => {
    const repository = new InMemoryRepository();
    const directory = await mkdtemp(join(tmpdir(), 'event-stream-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>t</title>');
    const server = createResearcherServer(repository, { dashboardDirectory: directory, eventStream: { pollMs: 20, heartbeatMs: 40 } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api`;
    try {
        const run = await (await fetch(base + '/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: defaultFixtureConfiguration(), idempotencyKey: 'stream' }) })).json();
        await repository.appendEvent({ runId: run.id, type: 'alpha', data: {} });
        await repository.appendEvent({ runId: run.id, type: 'beta', data: {} });

        const response = await fetch(`${base}/runs/${run.id}/events/stream?after=0`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
        const live = sseReader(response);
        assert.deepEqual(harness(await live.until(f => harness(f).length >= 2)).map(f => f.id), ['1', '2']);
        await repository.appendEvent({ runId: run.id, type: 'alpha', data: {} });
        assert.equal(harness(await live.until(f => harness(f).length >= 3))[2]!.id, '3');
        await live.until(f => f.some(frame => frame.event === 'comment'));
        await repository.saveRun({ ...(await repository.getRun(run.id))!, status: 'completed' });
        const end = (await live.until(f => f.some(frame => frame.event === 'end'))).find(frame => frame.event === 'end')!;
        assert.deepEqual(end.data, { status: 'completed' });

        const resumed = sseReader(await fetch(`${base}/runs/${run.id}/events/stream?type=alpha`, { headers: { 'Last-Event-ID': '1' } }));
        assert.deepEqual(harness(await resumed.until(f => f.some(frame => frame.event === 'end'))).map(f => f.id), ['3']);

        assert.equal((await fetch(`${base}/runs/${run.id}/events/stream?to=3`)).status, 400);
        assert.equal((await fetch(`${base}/runs/missing/events/stream`)).status, 404);
    } finally {
        server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
});
