import type { Json, MemorySnapshot, Role, Run, ToolCall } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory, Scenario } from '@sidechannel/contracts/harness/server';
import type { EventSink } from './event-recorder.js';
import { executeTool } from './gateway.js';

/** Loop-owned turn outcome; admission mutates it exactly where the loop used to. */
export interface TurnState {
    ended: boolean;
    reason: string;
}

export interface ToolAdmissionOptions {
    runId: string;
    run: Run;
    scenario: Scenario;
    memory: PrivateMemory;
    recorder: EventSink;
    checkpoint: () => Promise<void>;
}

/**
 * Tool admission for one model step: proposal recording, allowance charging, operation
 * fingerprint dedupe/replay, dispatch through `executeTool`, yield detection, disposition
 * inference and the unexecuted/failed fan-out. Moved verbatim from the per-step loop of
 * `HarnessScheduler.run()`; `ended`/`reason` live in the caller's `TurnState`.
 */
export class ToolAdmission {
    constructor(private readonly options: ToolAdmissionOptions) { }

    async handle(calls: ToolCall[], invocationId: string, role: Role, snapshot: MemorySnapshot, state: TurnState): Promise<void> {
        const { run, runId, scenario, memory, recorder, checkpoint } = this.options;
        for (let index = 0; index < calls.length; index++) {
            const call = calls[index]!;
            await recorder.emit('tool_requested', { call, index }, { invocationId, toolCallId: call.id, operationId: `${runId}:turn:${run.turn}:call:${call.id}` });
        }
        try {
            await checkpoint();
        }
        catch (error) {
            for (const call of calls)
                await recorder.emit('tool_unexecuted', { call, reason: error instanceof Error ? error.message : String(error) }, { invocationId, toolCallId: call.id, operationId: `${runId}:turn:${run.turn}:call:${call.id}` });
            throw error;
        }
        for (const [callIndex, call] of calls.entries()) {
            let admitted = false;
            try {
                const operationId = `${runId}:turn:${run.turn}:call:${call.id}`;
                let result: Json;
                if (state.ended || run.remainingAllowance! <= 0) {
                    result = { ok: false, disposition: 'unexecuted', reason: state.reason };
                    await recorder.emit('tool_unexecuted', { call, reason: state.reason }, { invocationId, toolCallId: call.id, operationId });
                }
                else {
                    await checkpoint();
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
                        const outcome = await executeTool(run, role, scenario, memory, snapshot, { runId, agentId: role.id, operationId }, call.name, call.arguments);
                        result = outcome.result;
                        run.operations[operationId] = { fingerprint, result };
                        await recorder.persist();
                        if (outcome.changed)
                            await recorder.emit(outcome.changed, { before: outcome.before, after: outcome.after }, { operationId, toolCallId: call.id });
                        if (outcome.yielded) {
                            state.ended = true;
                            state.reason = 'explicit_yield';
                        }
                    }
                    await recorder.emit('tool_result', { result, disposition: (result as {
                            disposition?: string;
                        }).disposition ?? ((result as {
                            ok?: boolean;
                        }).ok === false ? 'invalid' : 'executed'), remainingAllowance: run.remainingAllowance }, { invocationId, toolCallId: call.id, operationId });
                    if (!state.ended && run.remainingAllowance === 0) {
                        state.ended = true;
                        state.reason = 'budget_exhausted';
                    }
                }
                snapshot.messages.push({ role: 'tool', content: JSON.stringify({ result, remainingAllowance: run.remainingAllowance }), toolCallId: call.id, toolName: call.name });
            }
            catch (error) {
                if (!recorder.evidenceFailed) {
                    const failure = error instanceof Error ? error.message : String(error);
                    await recorder.emit(admitted ? 'tool_failed' : 'tool_unexecuted', { call, reason: failure }, { invocationId, toolCallId: call.id, operationId: `${runId}:turn:${run.turn}:call:${call.id}` });
                    for (const pending of calls.slice(callIndex + 1)) {
                        await recorder.emit('tool_unexecuted', { call: pending, reason: failure }, { invocationId, toolCallId: pending.id, operationId: `${runId}:turn:${run.turn}:call:${pending.id}` });
                    }
                }
                throw error;
            }
        }
    }
}
