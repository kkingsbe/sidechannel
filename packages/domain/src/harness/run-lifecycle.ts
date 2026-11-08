import { DomainFailure } from '@sidechannel/contracts/errors';
import { isTerminalRun } from '@sidechannel/contracts/harness/contracts';
import type { RunSummary } from '@sidechannel/contracts/harness/repository';
import { RunHasDependents, type RunDependencyReader, type RunDependents, type RunLifecycleResult, type RunLifecycleStore, type RunPurgeReport, type RunRecordPurger } from '@sidechannel/contracts/harness/run-lifecycle';
import type { JobLifecycleStore } from '@sidechannel/contracts/analysis/jev-repository';
import type { ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import type { ResearchStore } from '@sidechannel/contracts/analysis/store';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';

/** Ids listed per dependency kind; the 409 names these, then counts the rest. */
export const DEPENDENT_ID_LIMIT = 25;
const REVIEW_COUNT_LIMIT = 200;

export interface RunDependencySources {
    analyses?: Pick<JobLifecycleStore, 'listJobs'>;
    reviews?: Pick<ReviewStore, 'page'>;
    research?: Pick<ResearchStore, 'page'>;
}

/**
 * Policy: a run that Jev analyses, run-scope reviews, human outcome reviews or monitor evaluations
 * cite cannot be deleted. Those records are append-only research evidence that embeds the run's
 * event ids and hashes; cascading would silently destroy review work and orphan exported analyses.
 */
export function createRunDependencyReader({ analyses, reviews, research }: RunDependencySources): RunDependencyReader {
    return {
        async findRunDependents(runId) {
            const [jobs, runReviews, outcomeReviews, evaluations] = await Promise.all([
                analyses?.listJobs(runId, { limit: DEPENDENT_ID_LIMIT }),
                reviews?.page('reviews', 'run:' + runId, '', REVIEW_COUNT_LIMIT),
                research?.page('run_outcome_reviews', { runId }, '', REVIEW_COUNT_LIMIT),
                research?.page('monitor_evaluations', { runIds: runId }, '', DEPENDENT_ID_LIMIT),
            ]);
            return { analyses: jobs?.items.map(job => job.id) ?? [], runReviews: runReviews?.items.length ?? 0,
                outcomeReviews: outcomeReviews?.items.length ?? 0, monitorEvaluations: evaluations?.items.map(row => row.id) ?? [] };
        },
    };
}

export const hasDependents = (d: RunDependents): boolean => Boolean(d.analyses.length || d.monitorEvaluations.length || d.outcomeReviews || d.runReviews);

const plural = (n: number, noun: string, many = noun + 's') => `${n} ${n === 1 ? noun : many}`;

export function describeDependents(d: RunDependents): string {
    const parts = [
        d.analyses.length && `${plural(d.analyses.length, 'Jev analysis', 'Jev analyses')} (${d.analyses.join(', ')})`,
        d.monitorEvaluations.length && `${plural(d.monitorEvaluations.length, 'monitor evaluation')} (${d.monitorEvaluations.join(', ')})`,
        d.outcomeReviews && plural(d.outcomeReviews, 'outcome review'),
        d.runReviews && plural(d.runReviews, 'Jev run review'),
    ].filter(Boolean);
    return parts.join(', ');
}

/** Healthcare evaluator references and evaluations are derived from the run alone, so they go with it. */
export function healthcareRunPurger(catalog: Pick<HealthcareCatalog, 'deleteRunRecords'>): RunRecordPurger {
    return {
        async purgeRunRecords(runId) {
            const { references, evaluations } = await catalog.deleteRunRecords(runId);
            return { healthcare_evaluator_references: references, healthcare_evaluations: evaluations };
        },
    };
}

export type RunLifecycleAction = 'archive' | 'unarchive' | 'delete';

export const RUN_LIFECYCLE_ACTIONS: readonly RunLifecycleAction[] = ['archive', 'unarchive', 'delete'];

export interface RunLifecyclePorts {
    runs: RunLifecycleStore & { getRunSummary(id: string): Promise<RunSummary | null> };
    dependencies?: RunDependencyReader;
    /** Purged before the run row goes, in order; every purge is idempotent so a failed delete can simply be repeated. */
    purgers?: readonly RunRecordPurger[];
    now?: () => Date;
}

export interface RunLifecycleOutcome { id: string; launchKey: string; action: RunLifecycleAction; archivedAt?: string; purged?: RunPurgeReport }

export class RunLifecycleService {
    constructor(private readonly ports: RunLifecyclePorts) { }

    async archive(id: string): Promise<RunLifecycleOutcome> {
        const run = await this.require(id);
        if (run.archivedAt) return { id, launchKey: run.launchKey, action: 'archive', archivedAt: run.archivedAt };
        this.requireTerminal(run, 'archived');
        const archivedAt = (this.ports.now?.() ?? new Date()).toISOString();
        this.settle(id, 'archived', await this.ports.runs.setRunArchived(id, archivedAt));
        return { id, launchKey: run.launchKey, action: 'archive', archivedAt };
    }

    async unarchive(id: string): Promise<RunLifecycleOutcome> {
        const run = await this.require(id);
        this.settle(id, 'unarchived', await this.ports.runs.setRunArchived(id, null));
        return { id, launchKey: run.launchKey, action: 'unarchive' };
    }

    /** Permanent. Frees the run's launchKey. Refuses non-terminal runs and runs that analyses, reviews or evaluations cite. */
    async delete(id: string): Promise<RunLifecycleOutcome> {
        const run = await this.require(id);
        this.requireTerminal(run, 'deleted');
        const dependents = await this.ports.dependencies?.findRunDependents(id);
        if (dependents && hasDependents(dependents))
            throw new RunHasDependents(id, dependents, `Run ${id} cannot be deleted because it is cited by ${describeDependents(dependents)}. Those records are append-only evidence, so archive the run instead.`);
        const purged: RunPurgeReport = {};
        for (const purger of this.ports.purgers ?? []) Object.assign(purged, await purger.purgeRunRecords(id));
        this.settle(id, 'deleted', await this.ports.runs.deleteRun(id));
        return { id, launchKey: run.launchKey, action: 'delete', purged };
    }

    private async require(id: string): Promise<RunSummary> {
        const run = await this.ports.runs.getRunSummary(id);
        if (!run) throw new DomainFailure('not-found', 'Run not found');
        return run;
    }

    private requireTerminal(run: RunSummary, verb: string): void {
        if (!isTerminalRun(run.status)) throw new DomainFailure('conflict', `Run ${run.id} is ${run.status}; only completed, failed, cancelled or interrupted runs can be ${verb}. The experiment worker owns active runs.`);
    }

    private settle(id: string, verb: string, result: RunLifecycleResult): void {
        if (result === 'not-found') throw new DomainFailure('not-found', 'Run not found');
        if (result === 'not-terminal') throw new DomainFailure('conflict', `Run ${id} is no longer terminal and was not ${verb}.`);
    }
}
