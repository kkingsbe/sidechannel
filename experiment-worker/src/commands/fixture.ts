import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { openRuntime } from '../harness/runtime.js';
import { acquireWorkerLease, workerLeaseMs } from '../harness/worker-lease.js';
import { buildMetadata } from '@sidechannel/domain/harness/provenance';

const runtime = await openRuntime();

const owner = randomUUID();

const lease = await acquireWorkerLease(runtime.repository, owner, {
    leaseMs: workerLeaseMs(),
    shouldStop: () => true,
    onLost(reason) {
        console.error(`Worker lease lost (${reason}); stopping the fixture.`);
        process.exit(1);
    },
});

if (!lease) {
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
    await mkdir(new URL('../../../agent/examples/', import.meta.url), { recursive: true });
    const file = new URL('../../../agent/examples/completed-fixture.json', import.meta.url);
    await writeFile(file, JSON.stringify({ schemaVersion: 1, kind: 'scripted-development-fixture', run, events }, null, 2) + '\n');
    console.log(JSON.stringify({ runId: run.id, status: run.status, events: events.length, export: file.pathname }));
    if (run.status !== 'completed')
        process.exitCode = 1;
}
finally {
    await lease.release();
    await runtime.close();
}