import { setTimeout as sleep } from 'node:timers/promises';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { Repository } from '@sidechannel/contracts/harness/server';

/** The slice of the Mongo repository the single-worker lease needs. */
export interface LeaseStore {
    acquireWorker(owner: string, leaseMs: number): Promise<boolean>;
    heartbeatWorker(owner: string): Promise<boolean>;
    releaseWorker(owner: string): Promise<void>;
    workerLease(): Promise<{ owner: string; ageMs: number | null } | null>;
}

export interface WorkerLease {
    /** Stops heartbeating and frees the lease for the next worker. */
    release(): Promise<void>;
}

export interface LeaseOptions {
    leaseMs: number;
    /** Called once when the lease is lost: another worker took it over, or renewal failed for a full lease period. */
    onLost(reason: string): void;
    /** Acquisition gives up and returns undefined once this is true. */
    shouldStop?(): boolean;
    log?(message: string): void;
    pollMs?: number;
}

export function workerLeaseMs(env: NodeJS.ProcessEnv = process.env, fallback = 30_000) {
    const raw = env.WORKER_LEASE_MS;
    if (raw === undefined || raw === '')
        return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 3_000)
        throw new Error('WORKER_LEASE_MS must be an integer of at least 3000');
    return value;
}

/**
 * Waits until this process holds the single-worker lease, then renews it every third of the lease period.
 * A crashed or killed holder stops renewing, so its lease expires on its own and no manual recovery is needed.
 */
export async function acquireWorkerLease(store: LeaseStore, owner: string, options: LeaseOptions): Promise<WorkerLease | undefined> {
    const { leaseMs, onLost, shouldStop = () => false, log = console.log, pollMs = 2_000 } = options;
    let lastWaitLog = -Infinity;
    while (!await store.acquireWorker(owner, leaseMs)) {
        if (shouldStop())
            return undefined;
        if (Date.now() - lastWaitLog >= 60_000) {
            lastWaitLog = Date.now();
            const holder = await store.workerLease().catch(() => null);
            const age = holder?.ageMs == null ? 'never' : `${Math.round(holder.ageMs / 1000)}s ago`;
            log(`Waiting for the worker lease held by ${holder?.owner ?? 'another worker'} (last heartbeat ${age}; it expires ${Math.round(leaseMs / 1000)}s after the holder stops).`);
        }
        await sleep(pollMs);
    }
    let lastRenewal = Date.now();
    let lost = false;
    let inFlight = false;
    const fail = (reason: string) => {
        if (lost)
            return;
        lost = true;
        clearInterval(timer);
        onLost(reason);
    };
    const timer = setInterval(() => {
        if (inFlight || lost)
            return;
        inFlight = true;
        store.heartbeatWorker(owner).then(held => {
            if (held)
                lastRenewal = Date.now();
            else
                fail('another worker took over the lease');
        }, error => {
            if (Date.now() - lastRenewal >= leaseMs)
                fail(`lease renewal failed for ${Math.round(leaseMs / 1000)}s: ${error instanceof Error ? error.message : String(error)}`);
        }).finally(() => { inFlight = false; });
    }, Math.max(1_000, Math.floor(leaseMs / 3)));
    timer.unref();
    return {
        async release() {
            lost = true;
            clearInterval(timer);
            await store.releaseWorker(owner);
        },
    };
}

export const ACTIVE_RUN_STATUSES: readonly Run['status'][] = ['running', 'reporting', 'stopping'];

/**
 * Marks runs left active by a dead worker as interrupted. Only the lease holder executes runs,
 * so once this process holds the lease every active run is abandoned. Runs are never resumed.
 */
export async function interruptAbandonedRuns(repository: Pick<Repository, 'listRuns' | 'saveRun' | 'appendEvent'>, reason: string) {
    const interrupted: string[] = [];
    for (const run of await repository.listRuns())
        if (ACTIVE_RUN_STATUSES.includes(run.status)) {
            run.status = 'interrupted';
            run.failureReason = reason;
            run.updatedAt = new Date().toISOString();
            await repository.saveRun(run);
            await repository.appendEvent({ runId: run.id, type: 'run_interrupted', data: { reason } });
            interrupted.push(run.id);
        }
    return interrupted;
}
