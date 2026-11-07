import type { Run } from '@sidechannel/contracts/harness/contracts';
import { COMPLETE_RUN_STATUSES, INCOMPLETE_RUN_STATUSES } from '@sidechannel/contracts/harness/contracts';
import type { RunSummary } from '@sidechannel/contracts/harness/repository';
import { SUMMARY_CONFIG_OMIT, SUMMARY_OMIT } from '@sidechannel/contracts/harness/repository';

export { SUMMARY_CONFIG_OMIT, SUMMARY_OMIT };

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
