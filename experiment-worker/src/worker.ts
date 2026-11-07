import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { EventLog, RunQueue, RunStateStore, WorkerGuard } from '@sidechannel/contracts/harness/server';
import type { Run } from '@sidechannel/contracts/harness/contracts';

/** Everything the loop needs. No concrete adapter, no Mastra, no database driver. */
export interface WorkerDeps {
    queue: RunQueue;
    guard: WorkerGuard;
    runState: RunStateStore;
    events: EventLog;
    scheduler(run: Run): { run(id: string): Promise<Run> };
    flush(): Promise<void>;
    close(): Promise<void>;
}

export async function runWorker(deps: WorkerDeps, owner: string = randomUUID()): Promise<void> {
    let stopping = false;
    let activeId: string | undefined;
    const stop = async () => { stopping = true; if (activeId) await deps.runState.requestCancel(activeId); };
    const onSignal = () => void stop();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    if (!await deps.guard.acquireWorker(owner)) {
        await deps.close();
        throw new Error('A worker owns this database. If its process crashed, use npm run recover only after stopping every worker.');
    }
    console.log('Harness worker ready; one run at a time.');
    try {
        while (!stopping) {
            const queued = (await deps.queue.listRuns()).filter(run => run.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || ((a.pairPosition ?? 0) - (b.pairPosition ?? 0)));
            const run = queued[0];
            if (!run) {
                await setTimeout(500);
                continue;
            }
            activeId = run.id;
            try {
                const result = await deps.scheduler(run).run(run.id);
                await deps.flush();
                console.log(`${run.id}: ${result.status}`);
            }
            catch (error) {
                try {
                    const latest = await deps.runState.getRun(run.id);
                    if (latest) {
                        latest.status = 'interrupted';
                        latest.failureReason = error instanceof Error ? error.message : 'Worker failed';
                        await deps.runState.saveRun(latest);
                        await deps.events.appendEvent({ runId: run.id, type: 'worker_interrupted', data: { reason: latest.failureReason } });
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
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        await deps.guard.releaseWorker(owner);
        await deps.close();
    }
}
