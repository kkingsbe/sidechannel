import { randomUUID } from 'node:crypto';
import type { Run, Message } from '@sidechannel/contracts/harness/contracts';
import type { EventLog, RunStateStore, PrivateMemory, ModelAdapter, Scenario } from '@sidechannel/contracts/harness/server';
import { fixtureScenario } from './scenario.js';
import { validateTokenBudget } from '@sidechannel/domain/harness/token-budget';
import { EventRecorder } from './event-recorder.js';
import { InferenceGateway, modelInputFor } from './inference-gateway.js';
import type { RetryPolicy } from './inference-retry.js';
import { ReportPhase } from './report-phase.js';
import { ToolAdmission, type TurnState } from './tool-admission.js';
import { RunTermination } from './termination.js';

/** Main exported this from the scheduler; the report phase owns it after the WS3b decomposition. */
export { REPORT_RETRY_PROMPT } from './report-phase.js';

export interface SchedulerOptions {
    runState: RunStateStore;
    events: EventLog;
    memory: PrivateMemory;
    adapter: ModelAdapter;
    scenario?: Scenario;
    /** Transport retry policy for model requests; defaults to `DEFAULT_RETRY_POLICY`. */
    retry?: RetryPolicy;
}

export class HarnessScheduler {
    private readonly ports: SchedulerOptions;
    constructor(options: SchedulerOptions) { this.ports = options; }
    async run(runId: string): Promise<Run> {
        const { runState, events, adapter, memory: underlyingMemory } = this.ports;
        const scenario = this.ports.scenario ?? fixtureScenario;
        if (!await runState.claimRun(runId, randomUUID())) {
            const existing = await runState.getRun(runId);
            if (!existing)
                throw new Error('Run missing');
            return existing;
        }
        const run = (await runState.getRun(runId))!;
        const started = Date.now();
        const recorder = new EventRecorder({ run, runId, runState, events });
        const termination = new RunTermination({ run, recorder });
        const memory: PrivateMemory = { load: (r, a) => underlyingMemory.load(r, a), save: (r, a, v) => recorder.guard(() => underlyingMemory.save(r, a, v)) };
        const boundary = async () => {
            if ((await runState.getRun(runId))?.cancelRequested) {
                run.cancelRequested = true;
                throw new Error('CANCELLED');
            }
            if (Date.now() - started > run.config.limits.maxDurationMs)
                throw new Error('Run duration cap exceeded');
        };
        const gateway = new InferenceGateway({ runId, run, adapter, recorder, checkpoint: boundary, startedAt: started, ...(this.ports.retry ? { retry: this.ports.retry } : {}) });
        const admission = new ToolAdmission({ runId, run, scenario, memory, recorder, checkpoint: boundary });
        const report = new ReportPhase({ runId, run, scenario, memory, gateway, recorder, checkpoint: boundary });
        try {
            const budgetErrors = validateTokenBudget(run.config);
            if (budgetErrors.length) throw new Error(budgetErrors.join('; '));
            run.status = 'running';
            await recorder.emit('run_started', { config: run.config });
            await recorder.persist();
            for (let round = 1; round <= run.config.scheduler.rounds; round++)
                for (const agentId of run.config.scheduler.order) {
                    await boundary();
                    const role = run.config.roles.find(r => r.id === agentId)!;
                    run.round = round;
                    run.turn++;
                    run.activeAgentId = agentId;
                    run.remainingAllowance = run.config.scheduler.toolCallsPerTurn;
                    termination.activeTurn = true;
                    await recorder.emit('turn_started', { allowance: run.remainingAllowance, turnId: `${runId}:turn:${run.turn}`, orderPosition: run.config.scheduler.order.indexOf(agentId), round });
                    await recorder.persist();
                    const snapshot = await memory.load(runId, agentId);
                    const state: TurnState = { ended: false, reason: 'model_step_limit' };
                    for (let step = 0; step < run.config.limits.maxModelStepsPerTurn && !state.ended; step++) {
                        const messages: Message[] = [{ role: 'system', content: `${scenario.initialContext(run.config, role)}\n${run.config.condition.text}\nPrivate working memory (agent-authored):\n${snapshot.notes}\nRound: ${run.round}/${run.config.scheduler.rounds}; order position: ${run.config.scheduler.order.indexOf(agentId) + 1}/${run.config.scheduler.order.length}; turn: ${run.turn}; remaining tool allowance: ${run.remainingAllowance}` }, ...snapshot.messages, { role: 'user', content: 'Continue your scheduled turn.' }];
                        const invocationId = `${runId}:turn:${run.turn}:step:${step}`;
                        const response = await gateway.infer(modelInputFor(run, runId, scenario, role, messages, 'action', invocationId));
                        snapshot.messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
                        if (!response.toolCalls.length) {
                            state.ended = true;
                            state.reason = 'text_only';
                        }
                        await admission.handle(response.toolCalls, invocationId, role, snapshot, state);
                        await memory.save(runId, agentId, snapshot);
                    }
                    if (!state.ended)
                        throw new Error('Model step limit exceeded');
                    await recorder.emit('turn_ended', { reason: state.reason, remainingAllowance: run.remainingAllowance });
                    termination.activeTurn = false;
                    await recorder.persist();
                }
            await report.run();
            await boundary();
            run.status = 'completed';
            run.activeAgentId = undefined;
            await recorder.persist();
            await boundary();
            await recorder.emit('run_completed', {});
        }
        catch (error) {
            await termination.terminate(error);
        }
        return run;
    }
}
