import type { HarnessEvent, Run } from '../harness/contracts.js';
import { EVIDENCE_CATEGORIES, type CanonicalStep, type CanonicalSideEffect, type CanonicalToolCall, type Diagnostic, type EvidenceAvailability, type NormalizedTrace, type ReasoningExtractor } from './evidence-contracts.js';
import { snapshotHash } from './configuration.js';

export const NORMALIZER_VERSION = 'jev-canonical-v1';
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const diagnostic = (code: string, message: string, events: HarnessEvent[] = [], severity: Diagnostic['severity'] = 'warning'): Diagnostic => ({ code, message, eventIds: events.map(e => e.id), severity });
/** Deliberate AI SDK step reasoning adapter. No histories, raw response text or inferred hidden reasoning. */
export const extractStepReasoning: ReasoningExtractor = event => {
    const data = object(event.data); const raw = object(data.raw);
    if (!Array.isArray(raw.steps)) return [];
    return raw.steps.flatMap((step, index) => {
        const reasoning = object(step).reasoning;
        if (!Array.isArray(reasoning)) return [];
        return reasoning.flatMap(part => {
            const p = object(part);
            return p.type === 'reasoning' && typeof p.text === 'string' && p.text ? [{ text: p.text, source: `model_response.raw.steps[${index}].reasoning` }] : [];
        });
    });
};
export function evidenceAvailability(steps: readonly CanonicalStep[]): EvidenceAvailability {
    const a = Object.fromEntries(EVIDENCE_CATEGORIES.map(c => [c, false])) as EvidenceAvailability;
    for (const s of steps) {
        a.assistantText ||= !!s.assistantText; a.finalReports ||= !!s.report?.raw;
        a.providerReasoning ||= !!s.providerReasoning?.length;
        for (const c of s.toolCalls) { a.toolArguments ||= c.arguments !== undefined; a.toolResults ||= c.result !== undefined || !!c.reason; }
        for (const e of s.sideEffects) {
            a.boardContent ||= e.type === 'board_post' || e.type === 'board_delivery';
            a.boardDelivery ||= e.type === 'board_delivery'; a.artifactChanges ||= e.type === 'artifact_updated'; a.privateMemory ||= e.type === 'memory_updated';
        }
    }
    return a;
}
/** Reconstruct only current invocation contributions. Raw source events are retained by the repository. */
export function normalizeTrace(run: Run, input: readonly HarnessEvent[], options: { extractReasoning?: ReasoningExtractor } = {}): NormalizedTrace {
    const events = [...input].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
    const diagnostics: Diagnostic[] = []; const seen = new Set<string>();
    for (const e of events) {
        if (e.runId !== run.id) throw new Error('Evidence contains another run');
        if (seen.has(e.id)) throw new Error(`Duplicate event ID: ${e.id}`); seen.add(e.id);
        if (!Number.isSafeInteger(e.sequence) || e.sequence < 1) throw new Error('Invalid event sequence');
    }
    for (let i = 1; i < events.length; i++) {
        if (events[i]!.sequence === events[i - 1]!.sequence) throw new Error('Duplicate event sequence');
        if (events[i]!.sequence > events[i - 1]!.sequence + 1) diagnostics.push(diagnostic('sequence_gap', 'Unresolved sequence gap; allocation gaps alone do not establish missing evidence.', [events[i - 1]!, events[i]!]));
    }
    if (!['completed', 'cancelled', 'failed', 'interrupted'].includes(run.status)) throw new Error('Analysis requires a terminal source run');
    if (run.status !== 'completed') diagnostics.push(diagnostic('incomplete_run', `Source run ended with status ${run.status}.`));
    const groups = new Map<string, HarnessEvent[]>();
    const operations = new Map<string, Set<string>>(); const toolOwners = new Map<string, Set<string>>();
    for (const e of events) {
        if (e.invocationId) {
            const list = groups.get(e.invocationId) ?? []; list.push(e); groups.set(e.invocationId, list);
            for (const [key, map] of [[e.operationId, operations], [e.toolCallId, toolOwners]] as const) if (key) { const ids = map.get(key) ?? new Set<string>(); ids.add(e.invocationId); map.set(key, ids); }
        }
    }
    const assigned = new Set(events.filter(e => e.invocationId).map(e => e.id));
    for (const e of events.filter(e => !e.invocationId && e.type !== 'report_submitted')) {
        // A tool ID is only a fallback when no operation identity exists; operation conflicts never use adjacency.
        const owners = e.operationId ? operations.get(e.operationId) : e.toolCallId ? toolOwners.get(e.toolCallId) : undefined;
        if (owners?.size === 1) { groups.get([...owners][0]!)!.push(e); assigned.add(e.id); }
        else if (e.operationId || e.toolCallId) diagnostics.push(diagnostic('unresolved_operation', 'Operation side effect has missing or ambiguous invocation ownership.', [e]));
    }
    // Scheduler emits actor-scoped reports immediately after their report request/response lifecycle.
    for (const e of events.filter(e => e.type === 'report_submitted' && !e.invocationId)) {
        const candidates = [...groups.values()].filter(g => {
            const req = g.find(x => x.type === 'model_requested');
            return req && req.agentId === e.agentId && object(req.data).phase === 'report' && req.sequence < e.sequence && !g.some(x => x.type === 'report_submitted') &&
                !events.some(x => x.sequence > req.sequence && x.sequence < e.sequence && x.type === 'model_requested');
        });
        if (candidates.length === 1) { candidates[0]!.push(e); assigned.add(e.id); }
        else diagnostics.push(diagnostic('unresolved_report', 'Report has no unique corresponding reporting lifecycle.', [e]));
    }
    const steps: CanonicalStep[] = [...groups.entries()].map(([invocationId, unsorted]) => {
        const group = unsorted.sort((a, b) => a.sequence - b.sequence); const first = group[0]!;
        const reqs = group.filter(e => e.type === 'model_requested'); const responses = group.filter(e => e.type === 'model_response');
        const req = reqs[0]; const response = responses[0]; const reportEvent = group.find(e => e.type === 'report_submitted');
        const request = object(req?.data); const result = object(response?.data); const report = object(reportEvent?.data);
        const ds: Diagnostic[] = [];
        if (reqs.length !== 1) ds.push(diagnostic('request_count', `Expected one model request; found ${reqs.length}.`, group));
        if (responses.length > 1 || !responses.length && !reportEvent) ds.push(diagnostic('response_count', `Expected one current response or submitted report; found ${responses.length} responses.`, group));
        const phase = request.phase === 'report' ? 'report' : 'action';
        if (phase === 'report' && !reportEvent) ds.push(diagnostic('missing_report', 'Reporting invocation has no submitted report.', group));
        const calls = new Map<string, CanonicalToolCall>();
        const addCall = (v: unknown): CanonicalToolCall | undefined => {
            const c = object(v); if (typeof c.id !== 'string' || typeof c.name !== 'string') return;
            const existing = calls.get(c.id);
            if (existing) {
                if (existing.name !== c.name || snapshotHash(existing.arguments ?? null) !== snapshotHash(c.arguments ?? null)) ds.push(diagnostic('conflicting_tool_identity', `Tool ID ${c.id} was reused with conflicting proposal content.`, group));
                return existing;
            }
            const call: CanonicalToolCall = { id: c.id, name: c.name, ...(c.arguments !== undefined ? { arguments: structuredClone(c.arguments) } : {}), admission: 'unknown', status: 'proposed', eventIds: [] }; calls.set(c.id, call); return call;
        };
        if (Array.isArray(result.toolCalls)) result.toolCalls.forEach(addCall);
        for (const e of group.filter(e => e.type.startsWith('tool_'))) {
            const d = object(e.data); let call = addCall(d.call);
            if (!call && e.toolCallId) call = calls.get(e.toolCallId);
            if (!call) { ds.push(diagnostic('unresolved_tool', 'Tool event has no matching proposal.', [e])); continue; }
            call.eventIds.push(e.id); call.operationId ??= e.operationId;
            if (e.type === 'tool_admitted') call.admission = 'admitted';
            if (e.type === 'tool_unexecuted') { call.admission = 'unexecuted'; call.status = 'unexecuted'; }
            if (e.type === 'tool_failed') call.status = 'failed';
            if (e.type === 'tool_result' || e.type === 'tool_deduplicated') {
                call.result = structuredClone(d.result); const disposition = d.disposition ?? object(d.result).disposition;
                call.status = ['denied', 'invalid', 'unexecuted'].includes(disposition) ? disposition : object(d.result).ok === false ? 'invalid' : 'executed';
            }
            if (typeof d.reason === 'string') call.reason = d.reason;
        }
        for (const c of calls.values()) if (c.status === 'proposed') ds.push(diagnostic('missing_tool_outcome', `Tool ${c.id} has no recorded outcome.`, group.filter(e => c.eventIds.includes(e.id))));
        const sideEffects = group.filter(e => ['board_post', 'board_delivery', 'memory_updated', 'artifact_updated'].includes(e.type)).map(e => {
            const d = object(e.data); const before = object(d.before); const after = object(d.after);
            const messages = Array.isArray(d.after) ? d.after : e.type === 'board_post' ? [d.after] : [];
            const memoryValue = (v: unknown) => { const x = object(v); return { ...(typeof x.version === 'number' ? { version: x.version } : {}), ...(typeof x.notes === 'string' ? { notes: x.notes } : {}) }; };
            const effect: CanonicalSideEffect = { type: e.type as CanonicalSideEffect['type'], eventId: e.id, sequence: e.sequence, operationId: e.operationId, toolCallId: e.toolCallId,
                before: e.type === 'memory_updated' ? memoryValue(d.before) : structuredClone(d.before), after: e.type === 'memory_updated' ? memoryValue(d.after) : structuredClone(d.after), messageIds: messages.map(m => object(m).id).filter(id => typeof id === 'string'),
                ...(typeof before.version === 'number' ? { beforeVersion: before.version } : {}), ...(typeof after.version === 'number' ? { afterVersion: after.version } : {}) };
            return effect;
        });
        const reasoning = response ? (options.extractReasoning ?? extractStepReasoning)(response) : [];
        return { id: `${run.id}:invocation:${invocationId}`, ordinal: 0, phase, agentId: req?.agentId ?? request.agentId ?? first.agentId ?? 'unknown', round: req?.round ?? first.round, turn: req?.turn ?? first.turn, invocationId,
            eventIds: group.map(e => e.id), sequenceStart: first.sequence, sequenceEnd: group.at(-1)!.sequence, closed: !!response || !!reportEvent,
            incomplete: ds.length > 0, diagnostics: ds,
            // Reports are represented once in their own category, never copied into assistant text as well.
            ...(phase === 'action' && typeof result.text === 'string' ? { assistantText: result.text } : {}),
            ...(reasoning.length ? { providerReasoning: reasoning } : {}),
            ...(reportEvent ? { report: { raw: typeof report.raw === 'string' ? report.raw : '', parsed: structuredClone(report.parsed), invalid: report.invalid === true } } : phase === 'report' && typeof result.text === 'string' ? { report: { raw: result.text, invalid: true } } : {}),
            toolCalls: [...calls.values()], sideEffects } satisfies CanonicalStep;
    }).sort((a, b) => a.sequenceStart - b.sequenceStart);
    steps.forEach((step, i) => { step.ordinal = i + 1; });
    return { version: NORMALIZER_VERSION, runId: run.id, steps, contextEventIds: events.filter(e => !assigned.has(e.id)).map(e => e.id), diagnostics: [...diagnostics, ...steps.flatMap(s => s.diagnostics)], availability: evidenceAvailability(steps),
        source: { runId: run.id, configHash: run.configHash, status: run.status, sequenceBoundary: events.at(-1)?.sequence ?? 0, eventCount: events.length, eventIds: events.map(e => e.id), evidenceHash: snapshotHash(events), normalizerVersion: NORMALIZER_VERSION } };
}
