import type { AnalysisWindow, CanonicalStep, EvidenceSelection, InputLimits, SerializedWindow } from '@sidechannel/contracts/analysis/evidence-contracts';
import { immutableSnapshot, snapshotHash, stableStringify } from './configuration.js';
import { evidenceAvailability } from './normalization.js';
import { SIDE_EFFECT_ENABLED, TOOL_EFFECT_ENABLED } from './evidence-selection.js';
import type { BudgetQuestion, QuestionBatch, WindowPreflight } from '@sidechannel/contracts/analysis/serialization';
import { assertTokenEstimatorVersion, DEFAULT_TOKEN_ESTIMATOR_VERSION, estimateTokens } from './token-estimator.js';

export { estimateTokens, DEFAULT_TOKEN_ESTIMATOR_VERSION, TOKEN_ESTIMATOR_VERSIONS, CALIBRATED_TOKENS_PER_BYTE } from './token-estimator.js';

export const SERIALIZATION_VERSION = 'jev-state-v1';

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

function projectNested(value: unknown, selection: EvidenceSelection): unknown {
    if (Array.isArray(value)) return value.map(v => projectNested(v, selection));
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
        const k = key.toLowerCase().replaceAll('_', '').replaceAll('-', '');
        if (!selection.privateMemory && ['notes', 'memory', 'privatememory', 'workingmemory', 'privatenotes'].includes(k)) continue;
        if (!selection.providerReasoning && ['reasoning', 'reasoningtext', 'reasoningcontent', 'chainofthought'].includes(k)) continue;
        if (!selection.artifactChanges && ['artifact', 'artifacts', 'artifactvalue', 'artifactchanges'].includes(k)) continue;
        if (!selection.finalReports && ['report', 'reports', 'finalreport', 'finalreports'].includes(k)) continue;
        if (!selection.boardContent && ['board', 'boardcontent', 'boardtext'].includes(k)) continue;
        if (!selection.boardDelivery && ['boarddelivery', 'deliveredmessages'].includes(k)) continue;
        if (!selection.boardContent && key === 'text' && 'authorId' in value && 'sequence' in value) continue;
        out[key] = projectNested(v, selection);
    }
    return out;
}

const meaningful = (v: unknown): boolean => v !== undefined && v !== null && (typeof v !== 'object' || Object.keys(v).length > 0);

function deduplicatePayload(value: unknown, effects: readonly { eventId: string; after?: unknown }[]): unknown {
    // Reference only byte-identical subtrees; additional result fields remain intact.
    const references = new Map<string, { evidenceRef: string; path: string }>();
    const index = (v: unknown, eventId: string, path: string) => {
        if (typeof v === 'string' && v.length || v && typeof v === 'object' && Object.keys(v).length) references.set(stableStringify(v), { evidenceRef: eventId, path });
        if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) index(child, eventId, `${path}.${key}`);
    };
    effects.forEach(e => index(e.after, e.eventId, 'after'));
    const replace = (v: unknown): unknown => {
        const ref = references.get(stableStringify(v)); if (ref) return ref;
        if (Array.isArray(v)) return v.map(replace);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)]));
        return v;
    };
    return replace(value);
}

function projectToolPayload(value: unknown, name: string, selection: EvidenceSelection): unknown {
    // Whole tool semantics matter: filtering only top-level side effects leaks through arguments/results.
    if (name === 'update_working_memory' && !selection.privateMemory) return undefined;
    if (['read_artifact', 'update_artifact'].includes(name) && !selection.artifactChanges) return undefined;
    if (name === 'post_board' && !selection.boardContent) {
        const v = obj(value); return { ...(typeof v.ok === 'boolean' ? { ok: v.ok } : {}), ...(obj(v.message).id ? { messageId: obj(v.message).id } : {}) };
    }
    if (name === 'read_board') {
        const v = obj(value); const { messages: _messages, ...rest } = v;
        if (!selection.boardDelivery) return projectNested(rest, selection);
        if (!selection.boardContent && Array.isArray(v.messages)) return { ...projectNested(rest, selection) as object, messages: v.messages.map(m => { const { text: _text, ...meta } = obj(m); return projectNested(meta, selection); }) };
    }
    return projectNested(value, selection);
}

export function serializeWindow(window: AnalysisWindow, input: readonly CanonicalStep[], selection: EvidenceSelection, staticContext = '', estimatorVersion: string = DEFAULT_TOKEN_ESTIMATOR_VERSION): SerializedWindow {
    const estimator = assertTokenEstimatorVersion(estimatorVersion);
    const byId = new Map(input.map(s => [s.id, s]));
    const steps = window.stepIds.map(id => { const s = byId.get(id); if (!s) throw new Error(`Window references missing step ${id}`); return s; });
    let hasEvidence = false;
    const projected = steps.map(s => {
        const { assistantText: _a, providerReasoning: _r, report: _report, toolCalls: _calls, sideEffects: _effects, ...metadata } = s;
        const toolCalls = s.toolCalls.map(c => {
            const { arguments: args, result, reason, ...meta } = c;
            const projectedArgs = selection.toolArguments ? projectToolPayload(args, c.name, selection) : undefined;
            const projectedResult = selection.toolResults ? projectToolPayload(result, c.name, selection) : undefined;
            hasEvidence ||= meaningful(projectedArgs) || meaningful(projectedResult) || selection.toolResults && !!reason || selection.toolArguments;
            const effects = s.sideEffects.filter(e => e.operationId && e.operationId === c.operationId && TOOL_EFFECT_ENABLED[e.type](selection));
            return { ...meta,
                ...(projectedArgs !== undefined ? { arguments: deduplicatePayload(projectedArgs, effects) } : {}),
                ...(projectedResult !== undefined ? { result: deduplicatePayload(projectedResult, effects) } : {}),
                ...(selection.toolResults && reason ? { reason } : {}) };
        });
        const sideEffects = s.sideEffects.map(e => {
            const { before, after, ...meta } = e;
            let enabled = SIDE_EFFECT_ENABLED[e.type](selection);
            let data = { before, after };
            if (e.type === 'board_delivery' && !selection.boardContent) data = { before: undefined, after: Array.isArray(after) ? after.map(v => { const { text: _text, ...m } = obj(v); return m; }) : undefined };
            if (enabled) hasEvidence = true;
            return { ...meta, ...(enabled ? projectNested(data, selection) as object : {}) };
        });
        hasEvidence ||= selection.assistantText && !!s.assistantText || selection.providerReasoning && !!s.providerReasoning?.length || selection.finalReports && !!s.report?.raw;
        return { ...metadata, toolCalls, sideEffects,
            ...(selection.assistantText && s.assistantText ? { assistantText: s.assistantText } : {}),
            ...(selection.providerReasoning && s.providerReasoning?.length ? { providerReasoning: s.providerReasoning } : {}),
            ...(selection.finalReports && s.report ? { report: { raw: s.report.raw, invalid: s.report.invalid } } : {}) };
    });
    const availability = evidenceAvailability(steps);
    const state = stableStringify({ serializationVersion: SERIALIZATION_VERSION, staticContext, window: { ...window }, evidence: { selection, availability }, steps: projected });
    return immutableSnapshot({ serializationVersion: SERIALIZATION_VERSION, windowId: window.id, state, hash: snapshotHash(state), bytes: Buffer.byteLength(state), estimatedTokens: estimateTokens(state, estimator), estimatorVersion: estimator, hasEvidence, availability, selection });
}

/** Batch only questions. Window state and membership are never changed to fit. */
export function preflightWindow(serialized: SerializedWindow, questions: readonly BudgetQuestion[], limits: InputLimits): WindowPreflight {
    const estimator = assertTokenEstimatorVersion(limits.estimatorVersion);
    if (serialized.estimatorVersion !== estimator) throw new Error(`Window was estimated with ${serialized.estimatorVersion}, but the input limits use ${estimator}`);
    const questionText = (q: BudgetQuestion) => stableStringify({ instructions: q.instructions, criteria: q.criteria });
    const effectiveSingle = limits.singleQuestionTokens - limits.headroomTokens;
    const effectiveCombined = limits.combinedQuestionTokens - limits.headroomTokens;
    const baseline = { bytes: serialized.bytes, estimatedTokens: serialized.estimatedTokens, estimatorVersion: estimator, effectiveLimits: structuredClone(limits) };
    const fail = (reason: string): WindowPreflight => ({ ...baseline, oversized: true, reason, batches: [] });
    if (questions.some(q => serialized.estimatedTokens + estimateTokens(questionText(q), estimator) > effectiveSingle)) return fail('Window state plus a question exceeds the estimated single-question context limit. Choose smaller windows or different evidence in a new analysis.');
    const bytesFor = (batch: readonly BudgetQuestion[]) => Buffer.byteLength(stableStringify({ state: serialized.state, questions: batch.map(q => ({ codeId: q.codeId, instructions: q.instructions, criteria: q.criteria })) })) + 2048;
    const tokensFor = (batch: readonly BudgetQuestion[]) => serialized.estimatedTokens + batch.reduce((total, q) => total + estimateTokens(questionText(q), estimator), 0);
    const batches: QuestionBatch[] = []; let current: BudgetQuestion[] = [];
    const flush = () => { if (current.length) batches.push({ codeIds: current.map(q => q.codeId), bytes: bytesFor(current), estimatedTokens: tokensFor(current) }); current = []; };
    for (const q of questions) {
        if (tokensFor([q]) > effectiveCombined || bytesFor([q]) > limits.maxBodyBytes) return fail('Window state plus one question exceeds the request limit. Choose smaller windows or different evidence in a new analysis.');
        if (current.length && (tokensFor([...current, q]) > effectiveCombined || bytesFor([...current, q]) > limits.maxBodyBytes)) flush();
        current.push(q);
    }
    flush();
    return { ...baseline, oversized: false, batches };
}

export function preflightQuestions(state: string, questions: BudgetQuestion[], limits: InputLimits): { oversized: boolean; diagnostics: string[]; batches: BudgetQuestion[][]; budget: WindowPreflight } {
    const estimator = assertTokenEstimatorVersion(limits.estimatorVersion);
    const serialized = { state, bytes: Buffer.byteLength(state), estimatedTokens: estimateTokens(state, estimator), estimatorVersion: estimator } as SerializedWindow;
    const budget = preflightWindow(serialized, questions, limits);
    return { oversized: budget.oversized, diagnostics: budget.reason ? [budget.reason] : [], batches: budget.batches.map(b => b.codeIds.map(id => questions.find(q => q.codeId === id)!)), budget };
}