import { randomUUID } from 'node:crypto';
import { reviewRevisionKey, type MemberQuery, type ReviewKind, type ReviewQuery, type ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import { AnalysisConflict, AnalysisNotFound, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';
import type { BatchStrategy, BatchShortfall, Decision, Review, ReviewMember, ReviewQueueItem, ReviewReason, ReviewWindow, ReviewContext, ReviewBatch, ReviewListFilter, ReviewQueueFilter } from '@sidechannel/contracts/analysis/jev-reviews';
import { jsonHash } from '../hashing.js';

const hash = jsonHash;

const text = (value: unknown, name: string, max = 200) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AnalysisValidation(`Invalid ${name}`); return value.trim(); };

const strings = (value: unknown, name: string) => { if (!Array.isArray(value) || value.length > 10000 || value.some(x => typeof x !== 'string')) throw new AnalysisValidation(`Invalid ${name}`); return [...new Set(value as string[])]; };

/** Default stratification (v2 spec section 9.2): confident negatives, the undecided band, confident positives. */
export const DEFAULT_STRATIFIED_BINS = [0, 0.3, 0.7, 1];
export const DEFAULT_PER_BIN = 10;
export const DEFAULT_MIN_GAP = 0.5;

/** Validates and normalizes a request `strategy`; absent means the v1 flagged-plus-random selection. */
export function parseBatchStrategy(value: unknown): BatchStrategy | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) throw new AnalysisValidation('Invalid strategy');
    const input = value as Record<string, unknown>;
    if (input.kind === 'flagged-plus-random') return { kind: 'flagged-plus-random' };
    if (input.kind === 'stratified') {
        const bins = input.bins ?? DEFAULT_STRATIFIED_BINS, perBin = input.perBin ?? DEFAULT_PER_BIN;
        if (!Array.isArray(bins) || bins.length < 2 || bins.length > 21 || bins.some((edge, i) => typeof edge !== 'number' || !Number.isFinite(edge) || edge < 0 || edge > 1 || i > 0 && edge <= (bins[i - 1] as number)))
            throw new AnalysisValidation('bins must be 2 to 21 strictly increasing edges within 0 and 1');
        if (!Number.isSafeInteger(perBin) || Number(perBin) < 1 || Number(perBin) > 1000) throw new AnalysisValidation('perBin must be an integer from 1 to 1000');
        return { kind: 'stratified', bins: bins as number[], perBin: Number(perBin) };
    }
    if (input.kind === 'disagreement') {
        const minGap = input.minGap ?? DEFAULT_MIN_GAP;
        if (typeof minGap !== 'number' || !Number.isFinite(minGap) || minGap <= 0 || minGap > 1) throw new AnalysisValidation('minGap must be greater than 0 and at most 1');
        return { kind: 'disagreement', minGap };
    }
    throw new AnalysisValidation('Unknown batch strategy');
}

/** Index of the bin holding `probability`; bins are [e0,e1), ..., [e(n-2),e(n-1)] with the last edge inclusive. -1 when outside every bin. */
export function binIndex(bins: readonly number[], probability: number): number {
    if (probability < bins[0]! || probability > bins[bins.length - 1]!) return -1;
    for (let i = 0; i < bins.length - 1; i++) if (probability < bins[i + 1]!) return i;
    return bins.length - 2;
}

/**
 * Stratified draw: per code, windows with a score are bucketed into `bins` and up to `perBin` are drawn from each
 * bin in seeded hash order. A bin with fewer windows than `perBin` yields a shortfall. Only primary scores are
 * considered; the caller passes context probabilities that exclude probe results.
 */
export function stratifiedSelection(windows: readonly ReviewWindow[], codeIds: readonly string[], strategy: { bins: number[]; perBin: number }, seed: string) {
    const selected = new Set<string>(), shortfalls: BatchShortfall[] = [], binCount = strategy.bins.length - 1;
    for (const codeId of codeIds) {
        const buckets: ReviewWindow[][] = Array.from({ length: binCount }, () => []);
        for (const window of windows) { const p = window.probabilities[codeId]; if (p != null) { const i = binIndex(strategy.bins, p); if (i >= 0) buckets[i]!.push(window); } }
        buckets.forEach((bucket, bin) => {
            const drawn = bucket.map(w => ({ id: w.id, rank: hash([seed, codeId, bin, w.id]) })).sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id.localeCompare(b.id)).slice(0, strategy.perBin);
            for (const row of drawn) selected.add(row.id);
            if (drawn.length < strategy.perBin) shortfalls.push({ codeId, bin, requested: strategy.perBin, drawn: drawn.length });
        });
    }
    return { selected, shortfalls };
}

/** Windows where some reviewer's latest decision (present 1, absent 0) and the score differ by at least `minGap`; uncertain labels never qualify. */
export function disagreementSelection(windows: readonly ReviewWindow[], codeIds: readonly string[], labels: readonly Pick<Review, 'subjectId' | 'codeId' | 'decision'>[], minGap: number): Set<string> {
    const byId = new Map(windows.map(w => [w.id, w])), selected = new Set<string>();
    for (const label of labels) {
        if (label.decision === 'uncertain' || !codeIds.includes(label.codeId)) continue;
        const score = byId.get(label.subjectId)?.probabilities[label.codeId];
        if (score != null && Math.abs((label.decision === 'present' ? 1 : 0) - score) >= minGap - 1e-9) selected.add(label.subjectId);
    }
    return selected;
}

/** Review history is append-only. Claimed names are never presented as verified accounts. */
export class ReviewService {
    constructor(readonly store: ReviewStore, private context: (analysisId: string) => Promise<ReviewContext>, private resolveWindow?: (analysisId: string, windowId: string) => Promise<ReviewWindow | null>) {}
    async save(analysisId: string, input: Record<string, unknown>): Promise<Review> {
        const ctx = await this.context(analysisId), scope = input.scope ?? 'window';
        if (scope !== 'window' && scope !== 'event') throw new AnalysisValidation('Analysis reviews support window or event scope; run outcomes require independent definition revisions');
        if (scope === 'event' && (Array.isArray(input.eventIds) ? input.eventIds.length : 0) !== 1)
            throw new AnalysisValidation('Event annotations require exactly one source event. Save separate annotations for additional events.');
        const subjectId = text(input.subjectId, 'subjectId'), codeId = text(input.codeId, 'codeId');
        if (!ctx.codeIds.includes(codeId)) throw new AnalysisValidation('Code is not in the frozen codebook');
        const window = ctx.windows.find(w => scope === 'window' ? w.id === subjectId : w.eventIds.includes(subjectId));
        if (!window) throw new AnalysisValidation('Review subject is outside the analysis');
        return this.append(ctx, { ...input, scope, subjectId, codeId }, scope === 'window' ? window.eventIds : [subjectId], window.stepIds);
    }
    async saveRunOutcome(context: { runId: string; definitionRevision: string; evidenceRevision: string; outcomeIds: string[]; eventIds: string[]; stepIds: string[] }, input: Record<string, unknown>) {
        const codeId = text(input.codeId, 'outcome ID'); if (!context.outcomeIds.includes(codeId)) throw new AnalysisValidation('Outcome is not in the frozen monitor definition');
        return this.append({ analysisId: 'run:' + context.runId, runId: context.runId, definitionRevision: context.definitionRevision, evidenceRevision: context.evidenceRevision, codeIds: context.outcomeIds, windows: [] }, { ...input, scope: 'run', subjectId: context.runId, codeId }, context.eventIds, context.stepIds);
    }
    private async append(ctx: ReviewContext, input: Record<string, unknown>, allowedEvents: string[], allowedSteps: string[]): Promise<Review> {
        if (input.definitionRevision !== ctx.definitionRevision || input.evidenceRevision !== ctx.evidenceRevision) throw new AnalysisConflict('Review evidence or definition revision is stale');
        const reviewer = text(input.reviewer, 'reviewer'), decision = input.decision;
        if (!['present', 'absent', 'uncertain'].includes(String(decision))) throw new AnalysisValidation('Invalid review decision');
        const rationale = text(input.rationale, 'rationale', 20000), eventIds = strings(input.eventIds ?? [], 'eventIds'), stepIds = strings(input.stepIds ?? [], 'stepIds');
        if (eventIds.some(id => !allowedEvents.includes(id)) || stepIds.some(id => !allowedSteps.includes(id))) throw new AnalysisValidation('Evidence reference is outside the review subject');
        if (typeof input.predictionsVisible !== 'boolean') throw new AnalysisValidation('predictionsVisible must be recorded');
        const expected = input.expectedRevision ?? 0; if (!Number.isSafeInteger(expected) || Number(expected) < 0) throw new AnalysisValidation('Invalid expectedRevision');
        const subject = hash([input.scope, input.subjectId, input.codeId, ctx.definitionRevision, ctx.evidenceRevision, reviewer]);
        if (Number(expected) > 0 && !await this.store.get('reviews', ctx.analysisId, reviewRevisionKey(subject, Number(expected)))) throw new AnalysisConflict('Review revision conflict');
        const review: Review = { id: randomUUID(), analysisId: ctx.analysisId, subjectId: String(input.subjectId), scope: input.scope as Review['scope'], codeId: String(input.codeId), definitionRevision: ctx.definitionRevision, evidenceRevision: ctx.evidenceRevision, reviewer, identityVerified: false, decision: decision as Decision, rationale, eventIds, stepIds, predictionsVisible: input.predictionsVisible, revision: Number(expected) + 1, createdAt: new Date().toISOString() };
        await this.store.insert('reviews', ctx.analysisId, reviewRevisionKey(subject, review.revision), review); return review;
    }
    async list(analysisId: string, after?: string, limit = 100, filter: ReviewListFilter = {}) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AnalysisValidation('limit must be between 1 and 500');
        const query: ReviewQuery = { ...filter };
        for (const key of ['windowId', 'reviewer', 'subjectId', 'codeId'] as const) if (filter[key] !== undefined) query[key] = text(filter[key], key);
        if (filter.scope !== undefined && !['window', 'event', 'run'].includes(filter.scope)) throw new AnalysisValidation('Invalid scope filter');
        if (filter.latest !== undefined && typeof filter.latest !== 'boolean') throw new AnalysisValidation('Invalid latest filter');
        if (filter.windowId) {
            const window = this.resolveWindow ? await this.resolveWindow(analysisId, filter.windowId) : (await this.context(analysisId)).windows.find(window => window.id === filter.windowId);
            if (!window) throw new AnalysisNotFound('Review window not found'); query.eventIds = window.eventIds;
        }
        const page = await this.store.queryReviews<Review>(analysisId, query, after, limit);
        return { items: page.items.map(row => row.value), nextCursor: page.nextCursor };
    }
    async listBatches(analysisId: string, after?: string, limit = 100) { return this.page<ReviewBatch>('batches', analysisId, after, limit); }
    private async page<T>(kind: ReviewKind, partition: string, after = '', limit = 100, selectedOnly = false, members?: MemberQuery) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AnalysisValidation('limit must be between 1 and 500');
        const page = await this.store.page<T>(kind, partition, after, limit, selectedOnly, members); return { items: page.items.map(row => row.value), nextCursor: page.nextCursor };
    }
    async createBatch(analysisId: string, input: Record<string, unknown>): Promise<ReviewBatch> {
        const ctx = await this.context(analysisId), seed = text(input.seed, 'seed'), randomSize = input.randomSize ?? Math.min(10, ctx.windows.length), threshold = input.threshold ?? 0.7;
        if (!Number.isSafeInteger(randomSize) || Number(randomSize) < 0 || Number(randomSize) > ctx.windows.length) throw new AnalysisValidation('randomSize must fit the eligible population');
        if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new AnalysisValidation('Invalid threshold');
        const codeIds = strings(input.codeIds ?? ctx.codeIds, 'codeIds'), manual = strings(input.manualWindowIds ?? [], 'manualWindowIds');
        if (codeIds.some(id => !ctx.codeIds.includes(id)) || manual.some(id => !ctx.windows.some(w => w.id === id))) throw new AnalysisValidation('Unknown code or window');
        if (input.mode !== undefined && !['assisted', 'blind'].includes(String(input.mode))) throw new AnalysisValidation('Invalid review mode');
        const strategy = parseBatchStrategy(input.strategy), driven = strategy?.kind === 'stratified' || strategy?.kind === 'disagreement';
        const population = [...ctx.windows].sort((a, b) => a.id.localeCompare(b.id)), rank = (id: string) => hash([seed, id]);
        // A stratified or disagreement strategy replaces the v1 flagged and random selection; manual picks still apply.
        const random = new Set(driven ? [] : [...population].sort((a, b) => rank(a.id).localeCompare(rank(b.id))).slice(0, Number(randomSize)).map(w => w.id));
        let shortfalls: BatchShortfall[] | undefined, strategic = new Set<string>();
        if (strategy?.kind === 'stratified') ({ selected: strategic, shortfalls } = stratifiedSelection(population, codeIds, strategy, seed));
        if (strategy?.kind === 'disagreement') strategic = disagreementSelection(population, codeIds, await this.latestWindowLabels(analysisId, ctx), strategy.minGap);
        const members: ReviewMember[] = population.map(window => {
            const reasons: ReviewReason[] = [];
            if (!driven && codeIds.some(code => window.probabilities[code] != null && window.probabilities[code]! >= threshold)) reasons.push('flagged');
            if (random.has(window.id)) reasons.push('random'); if (strategic.has(window.id)) reasons.push(strategy!.kind as 'stratified' | 'disagreement'); if (manual.includes(window.id)) reasons.push('manual');
            return { windowId: window.id, eligible: true, selected: reasons.length > 0, reasons, order: hash(['order', seed, window.id]) };
        });
        const batch: ReviewBatch = { id: randomUUID(), analysisId, createdAt: new Date().toISOString(), definitionRevision: ctx.definitionRevision, evidenceRevision: ctx.evidenceRevision, populationHash: hash(population.map(w => w.id)), populationSize: population.length, seed, randomSize: driven ? 0 : Number(randomSize), threshold, codeIds, selectedCount: members.filter(m => m.selected).length, mode: input.mode === 'blind' ? 'blind' : 'assisted', ...(strategy ? { strategy } : {}), ...(shortfalls ? { shortfalls } : {}) };
        for (const member of members) await this.store.insert('members', batch.id, member.order + ':' + member.windowId, member);
        await this.store.insert('batches', analysisId, batch.id, batch); return batch;
    }
    /** Latest per-reviewer window decisions for the context's definition and evidence revisions. */
    private async latestWindowLabels(analysisId: string, ctx: ReviewContext): Promise<Review[]> {
        const labels: Review[] = []; let after: string | undefined;
        do {
            const page = await this.store.queryReviews<Review>(analysisId, { scope: 'window', latest: true, definitionRevision: ctx.definitionRevision, evidenceRevision: ctx.evidenceRevision }, after, 500);
            labels.push(...page.items.map(row => row.value)); after = page.nextCursor ?? undefined;
        } while (after);
        return labels;
    }
    async getBatch(analysisId: string, batchId: string, options: { after?: string; limit?: number; reviewer?: string; provenance?: boolean; filter?: ReviewQueueFilter } = {}) {
        const stored = await this.store.get<ReviewBatch>('batches', analysisId, batchId); if (!stored) throw new AnalysisNotFound('Review batch not found');
        const batch = stored.value, blind = batch.mode === 'blind' && !options.provenance, filter = options.filter ?? 'all';
        if (!['all', 'unreviewed', 'uncertain', 'disagreement'].includes(filter)) throw new AnalysisValidation('Invalid review queue filter');
        if (options.reviewer !== undefined) options = { ...options, reviewer: text(options.reviewer, 'reviewer') };
        if (filter === 'unreviewed' && !options.reviewer) throw new AnalysisValidation('A reviewer is required for the unreviewed queue');
        const reviewed = new Set<string>(), uncertain = new Set<string>(), disagreement = new Set<string>();
        const targets = new Map<string, { decisions: Set<Decision>; windowIds: string[] }>();
        let eventWindows: Map<string, string[]> | undefined;
        if (filter !== 'all' || blind && options.reviewer) {
            let after: string | undefined;
            do {
                const reviews = await this.store.queryReviews<Review>(analysisId, { latest: true, definitionRevision: batch.definitionRevision, evidenceRevision: batch.evidenceRevision }, after, 500);
                for (const row of reviews.items) {
                    const review = row.value;
                    if (review.scope === 'event' && !eventWindows) {
                        eventWindows = new Map();
                        for (const window of (await this.context(analysisId)).windows) for (const eventId of window.eventIds) eventWindows.set(eventId, [...eventWindows.get(eventId) ?? [], window.id]);
                    }
                    const windowIds = review.scope === 'window' ? [review.subjectId] : review.scope === 'event' ? eventWindows?.get(review.subjectId) ?? [] : [];
                    for (const windowId of windowIds) {
                        if (options.reviewer && review.reviewer === options.reviewer) reviewed.add(windowId);
                        if (review.decision === 'uncertain') uncertain.add(windowId);
                    }
                    const targetId = hash([review.scope, review.subjectId, review.codeId]);
                    const target = targets.get(targetId) ?? { decisions: new Set<Decision>(), windowIds };
                    target.decisions.add(review.decision); targets.set(targetId, target);
                }
                after = reviews.nextCursor ?? undefined;
            } while (after);
            for (const target of targets.values()) if (target.decisions.size > 1) for (const windowId of target.windowIds) disagreement.add(windowId);
        }
        const members: MemberQuery = filter === 'unreviewed' ? { excludeWindowIds: [...reviewed] }
            : filter === 'uncertain' ? { includeWindowIds: [...uncertain] } : filter === 'disagreement' ? { includeWindowIds: [...disagreement] } : {};
        const page = await this.page<ReviewMember>('members', batchId, options.after, options.limit, true, members);
        const items: ReviewQueueItem[] = page.items.filter(m => m.selected).map(m => {
            return blind && !reviewed.has(String(m.windowId)) ? { windowId: m.windowId, selected: true } : m;
        });
        const { threshold, codeIds, seed, shortfalls, ...publicBatch } = batch; return { batch: blind ? publicBatch : batch, items, nextCursor: page.nextCursor };
    }
    async allReviews(analysisId: string): Promise<Review[]> {
        const all: Review[] = []; let after: string | undefined;
        do { const page = await this.store.page<Review>('reviews', analysisId, after, 500); all.push(...page.items.map(row => row.value)); after = page.nextCursor ?? undefined; } while (after); return all;
    }
    async *export(analysisId: string) {
        for (const kind of ['reviews', 'batches'] as const) {
            let after: string | undefined;
            do {
                const page = await this.store.page<{ id: string }>(kind, analysisId, after, 500);
                for (const row of page.items) {
                    yield { type: kind, data: row.value };
                    if (kind === 'batches') {
                        let memberAfter: string | undefined;
                        do { const members = await this.store.page<ReviewMember>('members', String(row.value.id), memberAfter, 500); for (const m of members.items) yield { type: 'review_batch_member', batchId: row.value.id, data: m.value }; memberAfter = members.nextCursor ?? undefined; } while (memberAfter);
                    }
                }
                after = page.nextCursor ?? undefined;
            } while (after);
        }
    }
}

export function adjudicate(reviews: readonly Review[], definitionRevision: string, evidenceRevision: string, outcomeId: string) {
    const latest = new Map<string, Review>();
    for (const review of reviews.filter(r => r.scope === 'run' && r.codeId === outcomeId && r.definitionRevision === definitionRevision && r.evidenceRevision === evidenceRevision)) if ((latest.get(review.reviewer)?.revision ?? 0) < review.revision) latest.set(review.reviewer, review);
    const judgments = [...latest.values()];
    if (judgments.length < 2) return { status: 'provisional' as const, decision: null, reviews: judgments.map(r => r.id) };
    if (new Set(judgments.map(r => r.decision)).size !== 1) return { status: 'disagreement' as const, decision: null, reviews: judgments.map(r => r.id) };
    return { status: 'agreed' as const, decision: judgments[0]!.decision, reviews: judgments.map(r => r.id), binaryReference: judgments[0]!.decision !== 'uncertain' };
}
