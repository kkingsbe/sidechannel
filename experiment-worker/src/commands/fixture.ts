import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { openRuntime } from '../harness/runtime.js';
import { buildMetadata } from '@sidechannel/domain/harness/provenance';
import { acquireWorkerLease, workerLeaseMs } from '../harness/worker-lease.js';

const runtime = await openRuntime();

const owner = randomUUID();

// The standalone fixture runs only while no worker holds the lease; it never waits for one.
const lease = await acquireWorkerLease(runtime.guard, owner, {
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
    const queued = await runtime.queue.createRun(createQueuedRun(config, `fixture-${randomUUID()}`));
    const run = await runtime.scheduler(queued).run(queued.id);
    await runtime.flush();
    const events = [];
    let cursor = 0;
    while (true) {
        const page = await runtime.events.listEvents(run.id, cursor, 1000);
        events.push(...page);
        if (page.length < 1000)
            break;
        cursor = page.at(-1)!.sequence;
    }
    await mkdir(new URL('../../../data/exports/', import.meta.url), { recursive: true });
    const file = new URL('../../../data/exports/completed-fixture.json', import.meta.url);
    await writeFile(file, JSON.stringify({ schemaVersion: 1, kind: 'scripted-development-fixture', run, events }, null, 2) + '\n');
    console.log(JSON.stringify({ runId: run.id, status: run.status, events: events.length, export: file.pathname }));
    if (run.status !== 'completed')
        process.exitCode = 1;
}
finally {
    await lease.release();
    await runtime.close();
}
