import type { Run } from '@sidechannel/contracts/harness/contracts';
import { COMPLETE_RUN_STATUSES, INCOMPLETE_RUN_STATUSES } from '@sidechannel/contracts/harness/contracts';
import type { RunArchiveFilter, RunSummary } from '@sidechannel/contracts/harness/repository';
import { SUMMARY_CONFIG_OMIT, SUMMARY_OMIT } from '@sidechannel/contracts/harness/repository';
import type { WorkerLeaseRecord } from '@sidechannel/contracts/harness/server';
import type { WorkerStatus } from '@sidechannel/contracts/server/contracts';

export { SUMMARY_CONFIG_OMIT, SUMMARY_OMIT };

/** Archived runs are hidden unless the query asks for them: `include` shows all, `only` shows just the archive. */
export function matchesArchive(run: Pick<Run, 'archivedAt'>, filter: RunArchiveFilter = 'exclude'): boolean {
    return filter === 'include' || (filter === 'only') === Boolean(run.archivedAt);
}

/**
 * A Run that may already have been read through a summary projection: the heavy fields may be absent.
 * `toRunSummary` tolerates both, which keeps the memory and Mongo adapters interchangeable.
 */
export type SummaryRun = Omit<Run, typeof SUMMARY_OMIT[number]> & Partial<Pick<Run, typeof SUMMARY_OMIT[number]>>;

/** Exclusion projection for Mongo reads that feed `toRunSummary`; derived from the same constants. */
export function summaryProjection(): Record<string, 0> {
    return {
        ...Object.fromEntries(SUMMARY_OMIT.map(field => [field, 0])),
        ...Object.fromEntries(SUMMARY_CONFIG_OMIT.map(field => [`config.scenario.${field}`, 0])),
    } as Record<string, 0>;
}

export function toRunSummary(run: SummaryRun): RunSummary {
    const { board, artifacts, reports, operations, scenarioState, config, ...summary } = run;
    const { assets, ...scenario } = config.scenario;
    return { ...summary, config: { label: config.label, phase: config.phase, model: config.model, condition: config.condition, scenario, scheduler: config.scheduler }, designation: config.model.provider === 'scripted' ? 'fixture' : config.phase, sourceCompleteness: COMPLETE_RUN_STATUSES.includes(run.status) ? 'recorded-terminal' : INCOMPLETE_RUN_STATUSES.includes(run.status) ? 'possibly-incomplete' : 'recording' };
}

/**
 * Dashboard view of the single-worker lease, shared by the memory and Mongo adapters. A live
 * holder offers its recorded run lanes; a lease written before parallel runs offers one. No
 * holder means no lanes.
 */
export function workerStatusOf(lease: WorkerLeaseRecord | null, leaseMs: number): WorkerStatus {
    if (!lease)
        return { capacity: 0, available: false, status: 'stopped', note: 'No experiment worker holds the lease.' };
    const live = lease.ageMs !== null && lease.ageMs < leaseMs;
    return { capacity: lease.capacity ?? 1, available: live, status: live ? 'active' : 'stale', ...(lease.startedAt ? { startedAt: lease.startedAt } : {}), ...(lease.heartbeatAt ? { heartbeatAt: lease.heartbeatAt } : {}),
        note: live ? `Worker heartbeat ${Math.round(lease.ageMs! / 1000)}s ago.` : 'Worker lease expired; the next worker to start takes it over and interrupts abandoned runs.' };
}
