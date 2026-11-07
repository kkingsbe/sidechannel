import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { RunSummary } from '@sidechannel/contracts/harness/repository';

export function summarizeRun(run: Run): RunSummary {
    const { board, artifacts, reports, operations, scenarioState, config, ...summary } = run;
    const { assets, ...scenario } = config.scenario;
    return { ...summary, config: { label: config.label, phase: config.phase, model: config.model, condition: config.condition, scenario, scheduler: config.scheduler }, designation: config.model.provider === 'scripted' ? 'fixture' : config.phase, sourceCompleteness: ['completed', 'cancelled'].includes(run.status) ? 'recorded-terminal' : ['failed', 'interrupted'].includes(run.status) ? 'possibly-incomplete' : 'recording' };
}