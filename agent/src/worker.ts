import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { openRuntime } from './harness/runtime.js';
const runtime = await openRuntime();
const owner = randomUUID();
let stopping = false;
let activeId: string | undefined;
async function stop() {
    stopping = true;
    if (activeId)
        await runtime.repository.requestCancel(activeId);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
if (!await runtime.repository.acquireWorker(owner)) {
    await runtime.close();
    throw new Error('A worker owns this database. If its process crashed, use npm run recover only after stopping every worker.');
}
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
    await runtime.repository.releaseWorker(owner);
    await runtime.close();
}
