import { randomUUID } from 'node:crypto';
import type { Run, Json, Message, NewEvent, Role } from '@sidechannel/contracts/harness/contracts';
import type { EventLog, RunStateStore, PrivateMemory, ModelAdapter, Scenario, ModelInput } from '@sidechannel/contracts/harness/server';
import { fixtureScenario } from './scenario.js';
import { executeTool, toolCatalog } from './gateway.js';
import { measureModelInput, validateTokenBudget } from '@sidechannel/domain/harness/token-budget';
import { EventRecorder } from './event-recorder.js';
import { RunTermination } from './termination.js';

export interface SchedulerOptions {
    runState: RunStateStore;
    events: EventLog;
    memory: PrivateMemory;
    adapter: ModelAdapter;
    scenario?: Scenario;
}

export class HarnessScheduler {
    constructor(private readonly options: SchedulerOptions) { }
    async run(runId: string): Promise<Run> {
        const { runState, events, adapter } = this.options;
        const underlyingMemory = this.options.memory;
        const scenario = this.options.scenario ?? fixtureScenario;
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
        const infer = async (input: ModelInput) => {
            await boundary();
            const accounting = measureModelInput(input, run.config);
            await recorder.emit('context_accounted', { phase: input.phase, ...accounting }, { invocationId: input.invocationId });
            if (accounting.exceeds) {
                await recorder.emit('context_limit_exceeded', { phase: input.phase, ...accounting }, { invocationId: input.invocationId });
                throw new Error(`${input.phase} context budget exceeded (${accounting.unit}); no silent trimming`);
            }
            await recorder.emit('model_requested', input, { invocationId: input.invocationId });
            input.timeoutMs = Math.max(1, Math.min(input.timeoutMs, run.config.limits.maxDurationMs - (Date.now() - started)));
            const controller = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const response = await Promise.race([adapter.complete({ ...input, signal: controller.signal }), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Model request timeout')); }, input.timeoutMs); })]);
                if (!response || typeof response.text !== 'string' || !Array.isArray(response.toolCalls))
                    throw new Error('Unparseable model response');
                await recorder.emit('model_response', response, { invocationId: input.invocationId });
                await recorder.emit('model_usage', { phase: input.phase, provider: input.model.provider,
                    source: response.usage ? (input.model.provider === 'scripted' ? 'scripted' : 'provider-reported') : 'unavailable',
                    usage: response.usage ?? null, inputAccounting: accounting }, { invocationId: input.invocationId });
                for (const [k, v] of Object.entries(response.usage ?? {}))
                    if (typeof v === 'number' && Number.isFinite(v))
                        run.usage[k] = (run.usage[k] ?? 0) + v;
                return response;
            }
            finally {
                if (timer)
                    clearTimeout(timer);
            }
        };
        const inputFor = (role: Role, messages: Message[], phase: 'action' | 'report', invocationId: string): ModelInput => ({ runId, agentId: role.id, threadId: `experiment-thread:${JSON.stringify([runId, role.id])}`, resourceId: `experiment-resource:${JSON.stringify([runId, role.id])}`, invocationId, phase, model: run.config.model, messages, tools: phase === 'report' ? [] : toolCatalog(run, role, scenario), timeoutMs: run.config.limits.requestTimeoutMs });
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
                    let ended = false;
                    let reason = 'model_step_limit';
                    for (let step = 0; step < run.config.limits.maxModelStepsPerTurn && !ended; step++) {
                        const messages: Message[] = [{ role: 'system', content: `${scenario.initialContext(run.config, role)}\n${run.config.condition.text}\nPrivate working memory (agent-authored):\n${snapshot.notes}\nRound: ${run.round}/${run.config.scheduler.rounds}; order position: ${run.config.scheduler.order.indexOf(agentId) + 1}/${run.config.scheduler.order.length}; turn: ${run.turn}; remaining tool allowance: ${run.remainingAllowance}` }, ...snapshot.messages, { role: 'user', content: 'Continue your scheduled turn.' }];
                        const invocationId = `${runId}:turn:${run.turn}:step:${step}`;
                        const response = await infer(inputFor(role, messages, 'action', invocationId));
                        snapshot.messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
                        if (!response.toolCalls.length) {
                            ended = true;
                            reason = 'text_only';
                        }
                        for (let index = 0; index < response.toolCalls.length; index++) {
                            const call = response.toolCalls[index]!;
                            await recorder.emit('tool_requested', { call, index }, { invocationId, toolCallId: call.id, operationId: `${runId}:turn:${run.turn}:call:${call.id}` });
                        }
                        try {
                            await boundary();
                        }
                        catch (error) {
                            for (const call of response.toolCalls)
                                await recorder.emit('tool_unexecuted', { call, reason: error instanceof Error ? error.message : String(error) }, { invocationId, toolCallId: call.id, operationId: `${runId}:turn:${run.turn}:call:${call.id}` });
                            throw error;
                        }
                        for (const [callIndex, call] of response.toolCalls.entries()) {
                            let admitted = false;
                            try {
                                const operationId = `${runId}:turn:${run.turn}:call:${call.id}`;
                                let result: Json;
                                if (ended || run.remainingAllowance! <= 0) {
                                    result = { ok: false, disposition: 'unexecuted', reason };
                                    await recorder.emit('tool_unexecuted', { call, reason }, { invocationId, toolCallId: call.id, operationId });
                                }
                                else {
                                    await boundary();
                                    run.remainingAllowance!--;
                                    admitted = true;
                                    await recorder.emit('tool_admitted', { call, remainingAllowance: run.remainingAllowance }, { invocationId, toolCallId: call.id, operationId });
                                    const fingerprint = JSON.stringify({ name: call.name, arguments: call.arguments });
                                    const previous = run.operations[operationId];
                                    if (previous && previous.fingerprint !== fingerprint)
                                        throw new Error('Ambiguous operation identity reuse');
                                    if (previous) {
                                        result = previous.result;
                                        await recorder.emit('tool_deduplicated', { result }, { operationId, toolCallId: call.id });
                                    }
                                    else {
                                        const outcome = await executeTool(run, role, scenario, memory, snapshot, { runId, agentId, operationId }, call.name, call.arguments);
                                        result = outcome.result;
                                        run.operations[operationId] = { fingerprint, result };
                                        await recorder.persist();
                                        if (outcome.changed)
                                            await recorder.emit(outcome.changed, { before: outcome.before, after: outcome.after }, { operationId, toolCallId: call.id });
                                        if (outcome.yielded) {
                                            ended = true;
                                            reason = 'explicit_yield';
                                        }
                                    }
                                    await recorder.emit('tool_result', { result, disposition: (result as {
                                            disposition?: string;
                                        }).disposition ?? ((result as {
                                            ok?: boolean;
                                        }).ok === false ? 'invalid' : 'executed'), remainingAllowance: run.remainingAllowance }, { invocationId, toolCallId: call.id, operationId });
                                    if (!ended && run.remainingAllowance === 0) {
                                        ended = true;
                                        reason = 'budget_exhausted';
                                    }
                                }
                                snapshot.messages.push({ role: 'tool', content: JSON.stringify({ result, remainingAllowance: run.remainingAllowance }), toolCallId: call.id, toolName: call.name });
                            }
                            catch (error) {
                                if (!recorder.evidenceFailed) {
                                    const failure = error instanceof Error ? error.message : String(error);
                                    await recorder.emit(admitted ? 'tool_failed' : 'tool_unexecuted', { call, reason: failure }, { invocationId, toolCallId: call.id, operationId: `${runId}:turn:${run.turn}:call:${call.id}` });
                                    for (const pending of response.toolCalls.slice(callIndex + 1)) {
                                        await recorder.emit('tool_unexecuted', { call: pending, reason: failure }, { invocationId, toolCallId: pending.id, operationId: `${runId}:turn:${run.turn}:call:${pending.id}` });
                                    }
                                }
                                throw error;
                            }
                        }
                        await memory.save(runId, agentId, snapshot);
                    }
                    if (!ended)
                        throw new Error('Model step limit exceeded');
                    await recorder.emit('turn_ended', { reason, remainingAllowance: run.remainingAllowance });
                    termination.activeTurn = false;
                    await recorder.persist();
                }
            await boundary();
            const final = scenario.finalize(run);
            await recorder.emit('artifact_frozen', final);
            run.status = 'reporting';
            run.activeAgentId = undefined;
            await recorder.persist();
            for (const role of run.config.roles) {
                await boundary();
                run.activeAgentId = role.id;
                const snapshot = await memory.load(runId, role.id);
                const input = inputFor(role, [{ role: 'system', content: `${scenario.initialContext(run.config, role)}\n${run.config.condition.text}\nPrivate working memory:\n${snapshot.notes}` }, ...snapshot.messages, { role: 'user', content: run.config.reportInstructions }], 'report', `${runId}:report:${role.id}:0`);
                const response = await infer(input);
                for (const [index, call] of response.toolCalls.entries()) {
                    const extra = { invocationId: input.invocationId, toolCallId: call.id, operationId: `${input.invocationId}:call:${call.id}` };
                    await recorder.emit('tool_requested', { call, index, phase: 'report' }, extra);
                    await recorder.emit('tool_unexecuted', { call, reason: 'reporting_tools_disabled', phase: 'report' }, extra);
                }
                let parsed: Json | null = null;
                try {
                    if (!response.toolCalls.length) {
                        const candidate = JSON.parse(response.text);
                        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && typeof candidate.ownActions === 'string' && typeof candidate.observations === 'string' && typeof candidate.limitations === 'string' && Object.keys(candidate).length === 3)
                            parsed = candidate;
                    }
                }
                catch { }
                run.reports.push({ agentId: role.id, raw: response.text, parsed });
                await recorder.emit('report_submitted', { raw: response.text, parsed, invalid: parsed === null, toolCalls: response.toolCalls });
                await recorder.persist();
            }
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
