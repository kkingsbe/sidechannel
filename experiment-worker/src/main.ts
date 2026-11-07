import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { openRuntime } from './harness/runtime.js';
import { acquireWorkerLease, interruptAbandonedRuns, workerLeaseMs, type WorkerLease } from './harness/worker-lease.js';

const leaseMs = workerLeaseMs();

const runtime = await openRuntime();

const owner = randomUUID();

let stopping = false;

let activeId: string | undefined;

let lease: WorkerLease | undefined;

async function stop() {
    stopping = true;
    if (activeId)
        await runtime.repository.requestCancel(activeId);
}

process.on('SIGINT', () => void stop());

process.on('SIGTERM', () => void stop());

// Node exits on these by default without running the finally below. Free the lease first so a
// restarted worker starts at once; it interrupts whatever run this process left active.
async function fatal(error: unknown) {
    console.error('Experiment worker crashed:', error);
    await Promise.race([lease?.release().catch(() => { }), setTimeout(5_000)]);
    process.exit(1);
}

process.on('uncaughtException', error => void fatal(error));

process.on('unhandledRejection', reason => void fatal(reason));

lease = await acquireWorkerLease(runtime.repository, owner, {
    leaseMs,
    shouldStop: () => stopping,
    onLost(reason) {
        // Another worker may already be executing runs; continuing would mean two writers.
        console.error(`Worker lease lost (${reason}); exiting without touching further runs.`);
        process.exit(1);
    },
});

if (!lease) {
    await runtime.close();
    process.exit(0);
}

for (const id of await interruptAbandonedRuns(runtime.repository, 'Worker stopped before the run finished; a replacement worker interrupted it (no automatic resume)'))
    console.log(`${id}: interrupted (abandoned by a previous worker)`);

console.log('Harness worker ready; one run at a time.');

try {
    while (!stopping) {
        const queued = (await runtime.repository.listRuns()).filter(run => run.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || ((a.pairPosition ?? 0) - (b.pairPosition ?? 0)));
        const run = queued[0];
        if (!run) {
            await setTimeout(500);
            continue;
        }
        activeId = run.id;
        try {
            const result = await runtime.scheduler(run).run(run.id);
            await runtime.flush();
            console.log(`${run.id}: ${result.status}`);
        }
        catch (error) {
            try {
                const latest = await runtime.repository.getRun(run.id);
                if (latest) {
                    latest.status = 'interrupted';
                    latest.failureReason = error instanceof Error ? error.message : 'Worker failed';
                    await runtime.repository.saveRun(latest);
                    await runtime.repository.appendEvent({ runId: run.id, type: 'worker_interrupted', data: { reason: latest.failureReason } });
                }
            }
            catch { }
            console.error(`${run.id}: execution stopped; inspect persisted failure evidence`);
        }
        finally {
            activeId = undefined;
        }
    }
}
finally {
    await lease.release();
    await runtime.close();
}
