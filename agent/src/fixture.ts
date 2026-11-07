import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { defaultFixtureConfiguration, resolveConfiguration } from './harness/config.js';
import { createQueuedRun } from './harness/scheduler.js';
import { openRuntime } from './harness/runtime.js';
import { buildMetadata } from './harness/provenance.js';
const runtime = await openRuntime();
const owner = randomUUID();
if (!await runtime.repository.acquireWorker(owner)) {
    await runtime.close();
    throw new Error('Stop the worker before running the standalone fixture.');
}
try {
    const config = resolveConfiguration({ ...defaultFixtureConfiguration(), build: await buildMetadata() });
    const queued = await runtime.repository.createRun(createQueuedRun(config, `fixture-${randomUUID()}`));
    const run = await runtime.scheduler(queued).run(queued.id);
    await runtime.flush();
    const events = [];
    let cursor = 0;
    while (true) {
        const page = await runtime.repository.listEvents(run.id, cursor, 1000);
        events.push(...page);
        if (page.length < 1000)
            break;
        cursor = page.at(-1)!.sequence;
    }
    await mkdir(new URL('../examples/', import.meta.url), { recursive: true });
    const file = new URL('../examples/completed-fixture.json', import.meta.url);
    await writeFile(file, JSON.stringify({ schemaVersion: 1, kind: 'scripted-development-fixture', run, events }, null, 2) + '\n');
    console.log(JSON.stringify({ runId: run.id, status: run.status, events: events.length, export: file.pathname }));
    if (run.status !== 'completed')
        process.exitCode = 1;
}
finally {
    await runtime.repository.releaseWorker(owner);
    await runtime.close();
}
