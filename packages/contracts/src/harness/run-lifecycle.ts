import { DomainFailure } from '../errors.js';

/** Outcome of a conditional lifecycle write. Only terminal runs may be archived or deleted. */
export type RunLifecycleResult = 'ok' | 'not-found' | 'not-terminal';

/**
 * The harness collections' side of run retirement. Both writes are conditional on the stored status,
 * so a run the experiment worker still owns is never touched, whatever a caller read earlier.
 */
export interface RunLifecycleStore {
    /** Archives (a timestamp) or unarchives (`null`). Archiving requires a terminal run; unarchiving does not. */
    setRunArchived(id: string, archivedAt: string | null): Promise<RunLifecycleResult>;
    /** Removes the run and every harness record keyed by it (events, counters, operations), atomically where the store allows. */
    deleteRun(id: string): Promise<RunLifecycleResult>;
}

/** Records elsewhere that cite a run's evidence. Their presence blocks deletion. */
export interface RunDependents {
    /** Jev analysis ids (capped). */
    analyses: string[];
    /** Monitor evaluation ids (capped). */
    monitorEvaluations: string[];
    /** Human outcome reviews recorded on the run (capped count). */
    outcomeReviews: number;
    /** Jev run-scope reviews recorded on the run (capped count). */
    runReviews: number;
}

export interface RunDependencyReader {
    findRunDependents(runId: string): Promise<RunDependents>;
}

/** What a purge removed, by store collection; reported to the researcher and used by tests. */
export type RunPurgeReport = Record<string, number>;

/** Deletes run-keyed records that live outside the harness collections (healthcare, Mastra private memory and traces). Idempotent. */
export interface RunRecordPurger {
    purgeRunRecords(runId: string): Promise<RunPurgeReport>;
}

/** Refusal raised when a run is cited by analyses, reviews or monitor evaluations. Carries the list for the 409 body. */
export class RunHasDependents extends DomainFailure {
    constructor(readonly runId: string, readonly dependents: RunDependents, message: string) { super('conflict', message); }
}
