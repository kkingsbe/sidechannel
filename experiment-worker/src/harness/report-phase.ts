import type { Json, Message, Run } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory, Scenario } from '@sidechannel/contracts/harness/server';
import type { EventSink } from './event-recorder.js';
import { validateReportCall } from './gateway.js';
import { modelInputFor, type Inferencer } from './inference-gateway.js';

/** Retry prompt appended when a report step produced no invalid submission (main 0d96464). */
export const REPORT_RETRY_PROMPT = 'Submit your final report by calling submit_report.';

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
 * Report phase: freeze the artifact, then collect one private report per role.
 *
 * The final report is a `submit_report` tool call (main 0d96464): the report step exposes
 * exactly that one tool, the gateway validates its three non-empty string fields, and
 * `limits.reportCalls` (1..5) bounds retries after an invalid or missing submission. Other
 * tools proposed in this phase are recorded but never executed; a second `submit_report` in
 * one response is unexecuted as a duplicate. If no attempt submits, the last response text is
 * recorded as an invalid report rather than repaired.
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
            const messages: Message[] = [{ role: 'system', content: `${scenario.initialContext(run.config, role)}\n${run.config.condition.text}\nPrivate working memory:\n${snapshot.notes}` }, ...snapshot.messages, { role: 'user', content: run.config.reportInstructions }];
            let submitted = false;
            let lastText = '';
            for (let step = 0; step < run.config.limits.reportCalls && !submitted; step++) {
                const input = modelInputFor(run, runId, scenario, role, [...messages], 'report', `${runId}:report:${role.id}:${step}`);
                const response = await gateway.infer(input);
                lastText = response.text;
                let handled = false;
                let invalidResult: Json | undefined;
                let failedCallId: string | undefined;
                for (const [index, call] of response.toolCalls.entries()) {
                    const extra = { invocationId: input.invocationId, toolCallId: call.id, operationId: `${input.invocationId}:call:${call.id}` };
                    await recorder.emit('tool_requested', { call, index, phase: 'report' }, extra);
                    if (call.name !== 'submit_report') {
                        await recorder.emit('tool_unexecuted', { call, reason: 'reporting_tools_disabled', phase: 'report' }, extra);
                        continue;
                    }
                    if (handled) {
                        await recorder.emit('tool_unexecuted', { call, reason: 'duplicate_report', phase: 'report' }, extra);
                        continue;
                    }
                    handled = true;
                    const validation = validateReportCall(call.arguments);
                    if (validation.ok) {
                        await recorder.emit('tool_result', { result: { ok: true }, disposition: 'executed' }, extra);
                        const parsed = validation.value as unknown as Json;
                        const raw = JSON.stringify(call.arguments);
                        run.reports.push({ agentId: role.id, raw, parsed });
                        await recorder.emit('report_submitted', { raw, parsed, invalid: false, toolCalls: response.toolCalls });
                        await recorder.persist();
                        submitted = true;
                    }
                    else {
                        invalidResult = { ok: false, error: 'Invalid report', disposition: 'invalid', details: validation.details };
                        failedCallId = call.id;
                        await recorder.emit('tool_result', { result: invalidResult, disposition: 'invalid' }, extra);
                    }
                }
                if (submitted)
                    break;
                if (step + 1 < run.config.limits.reportCalls) {
                    messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
                    for (const other of response.toolCalls)
                        messages.push({ role: 'tool', content: JSON.stringify({ result: other.id === failedCallId ? invalidResult : { ok: false, disposition: 'unexecuted', reason: 'reporting_tools_disabled' } }), toolCallId: other.id, toolName: other.name });
                    if (!invalidResult)
                        messages.push({ role: 'user', content: REPORT_RETRY_PROMPT });
                }
            }
            if (!submitted) {
                run.reports.push({ agentId: role.id, raw: lastText, parsed: null });
                await recorder.emit('report_submitted', { raw: lastText, parsed: null, invalid: true, toolCalls: [] });
                await recorder.persist();
            }
        }
    }
}
