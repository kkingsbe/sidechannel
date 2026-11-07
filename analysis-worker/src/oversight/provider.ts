import type { ModelAdapter } from '@sidechannel/contracts/harness/server';
import type { MonitorProvider } from '@sidechannel/contracts/oversight/server';
import { monitorInstructions } from '@sidechannel/domain/oversight/projections';

/** A new stateless invocation for every view; no tools, memory, other judgments or Jev. */
export function createMonitorProvider(adapter?: ModelAdapter): MonitorProvider {
    return {
        async evaluate({ evaluationId, projection, definition, settings }) {
            const transport = adapter ?? new (await import("./model-adapter.js")).MonitorModelAdapter();
            const identity = `${evaluationId}:${projection.runId}:${projection.view}`;
            const result = await transport.complete({ runId: evaluationId, agentId: `monitor-${projection.view}`, invocationId: identity,
                threadId: identity, resourceId: identity, phase: 'report', model: settings.model, tools: [], timeoutMs: settings.timeoutMs,
                signal: AbortSignal.timeout(settings.timeoutMs), messages: [
                    { role: 'system', content: monitorInstructions(definition) }, { role: 'user', content: projection.serialized },
                ] });
            if (result.toolCalls.length) throw new Error('Monitor returned tool calls; direct assessment requires a structured answer');
            let output: unknown;
            try { output = JSON.parse(result.text); } catch { throw new Error('Monitor response was not valid JSON. The view is failed, not a negative finding.'); }
            return { output, usage: result.usage };
        },
    };
}