import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { EventLog, RunQueue, RunStateStore, WorkerGuard } from '@sidechannel/contracts/harness/server';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import { acquireWorkerLease, interruptAbandonedRuns, workerLeaseMs, type WorkerLease } from './harness/worker-lease.js';

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

const ABANDONED_REASON = 'Worker stopped before the run finished; a replacement worker interrupted it (no automatic resume)';

/**
 * Runs queued runs one at a time while holding the single-worker lease. A crashed holder stops
 * heartbeating, so its lease expires and a replacement takes over: it marks the abandoned run
 * interrupted (never resumed) and starts work instead of blocking until someone recovers manually.
 */
export async function runWorker(deps: WorkerDeps, owner: string = randomUUID(), leaseMs: number = workerLeaseMs()): Promise<void> {
    let stopping = false;
    let activeId: string | undefined;
    let lease: WorkerLease | undefined;
    const stop = async () => { stopping = true; if (activeId) await deps.runState.requestCancel(activeId); };
    const onSignal = () => void stop();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    // Node exits on these by default without running the finally below. Free the lease first so a
    // restarted worker starts at once; it interrupts whatever run this process left active.
    const fatal = async (error: unknown) => {
        console.error('Experiment worker crashed:', error);
        await Promise.race([lease?.release().catch(() => { }), setTimeout(5_000)]);
        process.exit(1);
    };
    const onFatal = (error: unknown) => void fatal(error);
    process.on('uncaughtException', onFatal);
    process.on('unhandledRejection', onFatal);
    try {
        lease = await acquireWorkerLease(deps.guard, owner, {
            leaseMs,
            shouldStop: () => stopping,
            onLost(reason) {
                // Another worker may already be executing runs; continuing would mean two writers.
                console.error(`Worker lease lost (${reason}); exiting without touching further runs.`);
                process.exit(1);
            },
        });
        if (!lease)
            return;
        // Only the lease holder executes runs, so every still-active run is abandoned. Queued runs are untouched.
        const interrupted = await interruptAbandonedRuns({
            listRuns: () => deps.queue.listRuns(),
            saveRun: run => deps.runState.saveRun(run),
            appendEvent: event => deps.events.appendEvent(event),
        }, ABANDONED_REASON);
        for (const id of interrupted)
            console.log(`${id}: interrupted (abandoned by a previous worker)`);
        console.log('Harness worker ready; one run at a time.');
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
        process.off('uncaughtException', onFatal);
        process.off('unhandledRejection', onFatal);
        await lease?.release();
        await deps.close();
    }
}
