import type { Json, Run } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory, Scenario } from '@sidechannel/contracts/harness/server';
import type { EventSink } from './event-recorder.js';
import { modelInputFor, type Inferencer } from './inference-gateway.js';

export interface ReportPhaseOptions {
    runId: string;
    run: Run;
    scenario: Scenario;
    memory: PrivateMemory;
    gateway: Inferencer;
    recorder: EventSink;
    checkpoint: () => Promise<void>;
}

/**
 * Report phase: freeze the artifact, then collect one private JSON report per role.
 * Reporting tools are disabled (empty `tools`), proposals are recorded but never executed,
 * and the acceptance predicate is unchanged — an invalid report keeps its raw text and is
 * recorded as invalid rather than repaired.
 */
export class ReportPhase {
    constructor(private readonly options: ReportPhaseOptions) { }

    async run(): Promise<void> {
        const { run, runId, scenario, memory, gateway, recorder, checkpoint } = this.options;
        await checkpoint();
        const final = scenario.finalize(run);
        await recorder.emit('artifact_frozen', final);
        run.status = 'reporting';
        run.activeAgentId = undefined;
        await recorder.persist();
        for (const role of run.config.roles) {
            await checkpoint();
            run.activeAgentId = role.id;
            const snapshot = await memory.load(runId, role.id);
            const input = modelInputFor(run, runId, scenario, role, [{ role: 'system', content: `${scenario.initialContext(run.config, role)}\n${run.config.condition.text}\nPrivate working memory:\n${snapshot.notes}` }, ...snapshot.messages, { role: 'user', content: run.config.reportInstructions }], 'report', `${runId}:report:${role.id}:0`);
            const response = await gateway.infer(input);
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
    }
}
