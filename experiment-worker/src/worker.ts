import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { EventLog, RunQueue, RunStateStore, WorkerGuard } from '@sidechannel/contracts/harness/server';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import { acquireWorkerLease, interruptAbandonedRuns, workerConcurrency, workerLeaseMs, type WorkerLease } from './harness/worker-lease.js';

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

/** Queue order: oldest launch first, and a matched pair's positions in order. */
const queueOrder = (a: Run, b: Run) => a.createdAt.localeCompare(b.createdAt) || ((a.pairPosition ?? 0) - (b.pairPosition ?? 0));

export interface WorkerOptions {
    owner?: string;
    leaseMs?: number;
    /** Parallel run lanes; defaults to `WORKER_CONCURRENCY`. */
    concurrency?: number;
    /** Stops the worker like SIGINT/SIGTERM: active runs are cancelled and awaited. */
    signal?: AbortSignal;
}

/**
 * Runs up to `concurrency` queued runs at once while holding the single-worker lease. Each run
 * owns its board, artifacts, scenario state, events and private memory, so lanes share nothing
 * but the process. A crashed holder stops heartbeating, so its lease expires and a replacement
 * takes over: it marks every run this process left active interrupted (never resumed).
 */
export async function runWorker(deps: WorkerDeps, options: WorkerOptions = {}): Promise<void> {
    const { owner = randomUUID(), leaseMs = workerLeaseMs(), concurrency = workerConcurrency(), signal } = options;
    let stopping = signal?.aborted ?? false;
    const active = new Map<string, Promise<void>>();
    let lease: WorkerLease | undefined;
    const stop = async () => { stopping = true; await Promise.all([...active.keys()].map(id => deps.runState.requestCancel(id))); };
    const onSignal = () => void stop();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    signal?.addEventListener('abort', onSignal, { once: true });
    // Node exits on these by default without running the finally below. Free the lease first so a
    // restarted worker starts at once; it interrupts whatever runs this process left active.
    const fatal = async (error: unknown) => {
        console.error('Experiment worker crashed:', error);
        await Promise.race([lease?.release().catch(() => { }), setTimeout(5_000)]);
        process.exit(1);
    };
    const onFatal = (error: unknown) => void fatal(error);
    process.on('uncaughtException', onFatal);
    process.on('unhandledRejection', onFatal);
    const execute = async (run: Run) => {
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
    };
    try {
        lease = await acquireWorkerLease(deps.guard, owner, {
            leaseMs,
            capacity: concurrency,
            shouldStop: () => stopping,
            onLost(reason) {
                // Another worker may already be executing runs; continuing would mean two writers per run.
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
        console.log(`Harness worker ready; up to ${concurrency} run${concurrency === 1 ? '' : 's'} at a time.`);
        while (!stopping) {
            if (active.size < concurrency) {
                const queued = (await deps.queue.listRuns()).filter(run => run.status === 'queued' && !active.has(run.id)).sort(queueOrder);
                // The scheduler's claim is the compare-and-set; `active` only stops this process starting a run twice.
                for (const run of queued.slice(0, concurrency - active.size)) {
                    if (stopping)
                        break;
                    active.set(run.id, execute(run).finally(() => { active.delete(run.id); }));
                }
            }
            await Promise.race([setTimeout(500), ...active.values()]);
        }
        // Stopping cancelled every active run; wait for each to reach its terminal state.
        await Promise.allSettled(active.values());
    }
    finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        signal?.removeEventListener('abort', onSignal);
        process.off('uncaughtException', onFatal);
        process.off('unhandledRejection', onFatal);
        await lease?.release();
        await deps.close();
    }
}
