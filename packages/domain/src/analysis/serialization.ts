import type { AnalysisWindow, BackgroundPart, CanonicalStep, EvidenceSelection, InputLimits, SerializedWindow } from '@sidechannel/contracts/analysis/evidence-contracts';
import { immutableSnapshot, snapshotHash, stableStringify } from './configuration.js';
import { evidenceAvailability } from './normalization.js';
import { SIDE_EFFECT_ENABLED, TOOL_EFFECT_ENABLED } from './evidence-selection.js';
import type { BudgetQuestion, QuestionBatch, WindowPreflight } from '@sidechannel/contracts/analysis/serialization';
import { assertTokenEstimatorVersion, DEFAULT_TOKEN_ESTIMATOR_VERSION, estimateTokens } from './token-estimator.js';

export { estimateTokens, DEFAULT_TOKEN_ESTIMATOR_VERSION, TOKEN_ESTIMATOR_VERSIONS, CALIBRATED_TOKENS_PER_BYTE } from './token-estimator.js';

/** Current model-facing serialization: evidence only, window-local aliases (spec section 5.1). */
export const SERIALIZATION_VERSION = 'jev-state-v2';

/** Pre-v2 serialization, kept callable to read v1 jobs and for the leak A/B smoke. */
export const SERIALIZATION_VERSION_V1 = 'jev-state-v1';

/** Version of the alias scheme (`s<ordinal>`, `c<n>`, `e<n>`, `w<n>`) recorded on v2 manifests. */
export const ALIAS_MAP_VERSION = 'alias-v1';

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

function deduplicatePayload(value: unknown, effects: readonly { eventId: string; after?: unknown }[], eventRef: (eventId: string) => string = id => id): unknown {
    // Reference only byte-identical subtrees; additional result fields remain intact.
    const references = new Map<string, { evidenceRef: string; path: string }>();
    const index = (v: unknown, eventId: string, path: string) => {
        if (typeof v === 'string' && v.length || v && typeof v === 'object' && Object.keys(v).length) references.set(stableStringify(v), { evidenceRef: eventId, path });
        if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) index(child, eventId, `${path}.${key}`);
    };
    effects.forEach(e => index(e.after, eventRef(e.eventId), 'after'));
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

/** How a projection names things: v1 keeps real IDs and reconstruction metadata, v2 aliases IDs and drops them. */
interface ProjectionShape {
    eventRef(eventId: string): string;
    step(s: CanonicalStep): Record<string, unknown>;
    call(s: CanonicalStep, meta: Record<string, unknown>): Record<string, unknown>;
    effect(s: CanonicalStep, meta: Record<string, unknown>): Record<string, unknown>;
}

const V1_SHAPE: ProjectionShape = {
    eventRef: id => id,
    step: s => { const { assistantText: _a, providerReasoning: _r, report: _report, toolCalls: _calls, sideEffects: _effects, ...metadata } = s; return metadata; },
    call: (_s, meta) => meta,
    effect: (_s, meta) => meta,
};

function selectWindowSteps(window: AnalysisWindow, input: readonly CanonicalStep[]): CanonicalStep[] {
    const byId = new Map(input.map(s => [s.id, s]));
    return window.stepIds.map(id => { const s = byId.get(id); if (!s) throw new Error(`Window references missing step ${id}`); return s; });
}

/** Evidence projection shared by both serializer versions; only naming and metadata differ (see `ProjectionShape`). */
function projectSteps(steps: readonly CanonicalStep[], selection: EvidenceSelection, shape: ProjectionShape): { projected: Record<string, unknown>[]; hasEvidence: boolean } {
    let hasEvidence = false;
    const projected = steps.map(s => {
        const metadata = shape.step(s);
        const toolCalls = s.toolCalls.map(c => {
            const { arguments: args, result, reason, ...meta } = c;
            const projectedArgs = selection.toolArguments ? projectToolPayload(args, c.name, selection) : undefined;
            const projectedResult = selection.toolResults ? projectToolPayload(result, c.name, selection) : undefined;
            hasEvidence ||= meaningful(projectedArgs) || meaningful(projectedResult) || selection.toolResults && !!reason || selection.toolArguments;
            const effects = s.sideEffects.filter(e => e.operationId && e.operationId === c.operationId && TOOL_EFFECT_ENABLED[e.type](selection));
            return { ...shape.call(s, meta),
                ...(projectedArgs !== undefined ? { arguments: deduplicatePayload(projectedArgs, effects, shape.eventRef) } : {}),
                ...(projectedResult !== undefined ? { result: deduplicatePayload(projectedResult, effects, shape.eventRef) } : {}),
                ...(selection.toolResults && reason ? { reason } : {}) };
        });
        const sideEffects = s.sideEffects.map(e => {
            const { before, after, ...meta } = e;
            const enabled = SIDE_EFFECT_ENABLED[e.type](selection);
            let data = { before, after };
            if (e.type === 'board_delivery' && !selection.boardContent) data = { before: undefined, after: Array.isArray(after) ? after.map(v => { const { text: _text, ...m } = obj(v); return m; }) : undefined };
            if (enabled) hasEvidence = true;
            return { ...shape.effect(s, meta), ...(enabled ? projectNested(data, selection) as object : {}) };
        });
        hasEvidence ||= selection.assistantText && !!s.assistantText || selection.providerReasoning && !!s.providerReasoning?.length || selection.finalReports && !!s.report?.raw;
        return { ...metadata, toolCalls, sideEffects,
            ...(selection.assistantText && s.assistantText ? { assistantText: s.assistantText } : {}),
            ...(selection.providerReasoning && s.providerReasoning?.length ? { providerReasoning: s.providerReasoning } : {}),
            ...(selection.finalReports && s.report ? { report: { raw: s.report.raw, invalid: s.report.invalid } } : {}) };
    });
    return { projected, hasEvidence };
}

/**
 * The v1 serializer (`jev-state-v1`): real IDs, reconstruction metadata and the frozen static context
 * inside the shared state. Kept so v1 jobs stay readable and for the leak A/B smoke; new analyses use
 * `serializeWindowV2`.
 */
export function serializeWindowV1(window: AnalysisWindow, input: readonly CanonicalStep[], selection: EvidenceSelection, staticContext = '', estimatorVersion: string = DEFAULT_TOKEN_ESTIMATOR_VERSION): SerializedWindow {
    const estimator = assertTokenEstimatorVersion(estimatorVersion);
    const steps = selectWindowSteps(window, input);
    const { projected, hasEvidence } = projectSteps(steps, selection, V1_SHAPE);
    const availability = evidenceAvailability(steps);
    const state = stableStringify({ serializationVersion: SERIALIZATION_VERSION_V1, staticContext, window: { ...window }, evidence: { selection, availability }, steps: projected });
    return immutableSnapshot({ serializationVersion: SERIALIZATION_VERSION_V1, windowId: window.id, state, hash: snapshotHash(state), bytes: Buffer.byteLength(state), estimatedTokens: estimateTokens(state, estimator), estimatorVersion: estimator, hasEvidence, availability, selection });
}

/** Pre-v2 name and signature of `serializeWindowV1`, retained for existing callers. */
export const serializeWindow = serializeWindowV1;

/** Allocates window-local aliases and remembers which real ID each stands for; a real ID never gets two aliases. */
class AliasRegistry {
    readonly map: Record<string, string> = {};
    private readonly byReal = new Map<string, string>();
    private readonly counters: Record<string, number> = {};
    /** Alias for `real` in `scope` (a tool call ID is only unique within its step), allocated on first use as `<prefix><n>`. */
    alias(prefix: string, real: string, scope = ''): string {
        const key = `${prefix}\u0000${scope}\u0000${real}`;
        const known = this.byReal.get(key); if (known) return known;
        const alias = `${prefix}${this.counters[prefix] = (this.counters[prefix] ?? 0) + 1}`;
        this.byReal.set(key, alias); this.map[alias] = real; return alias;
    }
    /** An alias with a caller-chosen name (step aliases follow the ordinal). */
    named(alias: string, real: string): string {
        if (alias in this.map && this.map[alias] !== real) throw new Error(`Alias ${alias} already names ${this.map[alias]}`);
        this.map[alias] = real; return alias;
    }
}

/**
 * The v2 serializer (`jev-state-v2`, spec section 5.1): evidence plus an optional shared `background` block. No static context; step, event and
 * tool-call IDs become window-local aliases resolved through `aliasMap`; sequence bounds, invocation IDs,
 * operation IDs and per-tool-call event IDs stay out of the model-facing state (the window record keeps them).
 */
export function serializeWindowV2(window: AnalysisWindow, input: readonly CanonicalStep[], selection: EvidenceSelection, estimatorVersion: string = DEFAULT_TOKEN_ESTIMATOR_VERSION, background?: { task?: string; policy?: string }): SerializedWindow {
    const estimator = assertTokenEstimatorVersion(estimatorVersion);
    const steps = selectWindowSteps(window, input);
    const aliases = new AliasRegistry();
    const windowRef = aliases.named(`w${window.index + 1}`, window.id);
    const shape: ProjectionShape = {
        eventRef: id => aliases.alias('e', id),
        step: s => ({ ref: aliases.named(`s${s.ordinal}`, s.id), agent: s.agentId, phase: s.phase,
            ...(s.round !== undefined ? { round: s.round } : {}), ...(s.turn !== undefined ? { turn: s.turn } : {}),
            ...(s.incomplete ? { incomplete: true } : {}),
            ...(s.diagnostics.length ? { diagnostics: s.diagnostics.map(d => ({ code: d.code, message: d.message, severity: d.severity })) } : {}) }),
        call: (s, meta) => ({ ref: aliases.alias('c', String(meta.id), s.id), name: meta.name, admission: meta.admission, status: meta.status }),
        effect: (s, meta) => ({ type: meta.type, ref: aliases.alias('e', String(meta.eventId)),
            ...(meta.toolCallId ? { call: aliases.alias('c', String(meta.toolCallId), s.id) } : {}),
            ...(Array.isArray(meta.messageIds) && meta.messageIds.length ? { messageIds: meta.messageIds } : {}),
            ...(meta.beforeVersion !== undefined ? { beforeVersion: meta.beforeVersion } : {}), ...(meta.afterVersion !== undefined ? { afterVersion: meta.afterVersion } : {}) }),
    };
    const { projected, hasEvidence } = projectSteps(steps, selection, shape);
    const availability = evidenceAvailability(steps);
    const activeAgents = [...new Set(steps.map(s => s.agentId))];
    const state = stableStringify({ serializationVersion: SERIALIZATION_VERSION, window: { ref: windowRef, startOrdinal: window.startOrdinal, endOrdinal: window.endOrdinal, agents: activeAgents, ...(window.partial ? { partial: true } : {}) },
        // Shared task/policy background (never the condition) is the one pipeline-added block; it measured closer to v1 than per-question copies.
        ...(background && Object.keys(background).length ? { background } : {}),
        evidence: { selection, availability }, steps: projected });
    return immutableSnapshot({ serializationVersion: SERIALIZATION_VERSION, windowId: window.id, state, hash: snapshotHash(state), bytes: Buffer.byteLength(state), estimatedTokens: estimateTokens(state, estimator), estimatorVersion: estimator, hasEvidence, availability, selection, aliasMap: aliases.map, activeAgents });
}

/** The real ID behind a window-local alias, or undefined. v1 windows carry no map and resolve to themselves. */
export function resolveAlias(serialized: Pick<SerializedWindow, 'aliasMap'>, ref: string): string | undefined {
    return serialized.aliasMap ? serialized.aliasMap[ref] : ref;
}

/** The background group a question belongs to: its sorted background parts, or empty for none. */
export const backgroundKey = (background: readonly BackgroundPart[] | undefined): string => [...new Set(background ?? [])].sort().join('+');

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
    // Spec 5.3: a request carries one background set, so questions are grouped by it (groups in first-seen order,
    // question order preserved within a group) and each group is packed under the same combined budget as before.
    const groups = new Map<string, BudgetQuestion[]>();
    for (const q of questions) { const key = backgroundKey(q.background); groups.set(key, [...(groups.get(key) ?? []), q]); }
    const batches: QuestionBatch[] = [];
    for (const [key, group] of groups) {
        let current: BudgetQuestion[] = [];
        const flush = () => { if (current.length) batches.push({ codeIds: current.map(q => q.codeId), bytes: bytesFor(current), estimatedTokens: tokensFor(current), backgroundKey: key, background: [...(current[0]!.background ?? [])].sort() }); current = []; };
        for (const q of group) {
            if (tokensFor([q]) > effectiveCombined || bytesFor([q]) > limits.maxBodyBytes) return fail('Window state plus one question exceeds the request limit. Choose smaller windows or different evidence in a new analysis.');
            if (current.length && (tokensFor([...current, q]) > effectiveCombined || bytesFor([...current, q]) > limits.maxBodyBytes)) flush();
            current.push(q);
        }
        flush();
    }
    return { ...baseline, oversized: false, batches };
}

/** The long-standing preview/launch shape of a window's budget: batches as question lists plus the full preflight. */
export function toLegacyPreflight(budget: WindowPreflight, questions: readonly BudgetQuestion[]): { oversized: boolean; diagnostics: string[]; batches: BudgetQuestion[][]; budget: WindowPreflight } {
    return { oversized: budget.oversized, diagnostics: budget.reason ? [budget.reason] : [], batches: budget.batches.map(b => b.codeIds.map(id => questions.find(q => q.codeId === id)!)), budget };
}

export function preflightQuestions(state: string, questions: BudgetQuestion[], limits: InputLimits): { oversized: boolean; diagnostics: string[]; batches: BudgetQuestion[][]; budget: WindowPreflight } {
    const estimator = assertTokenEstimatorVersion(limits.estimatorVersion);
    const serialized = { state, bytes: Buffer.byteLength(state), estimatedTokens: estimateTokens(state, estimator), estimatorVersion: estimator } as SerializedWindow;
    return toLegacyPreflight(preflightWindow(serialized, questions, limits), questions);
}