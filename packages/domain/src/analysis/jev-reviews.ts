import { randomUUID } from 'node:crypto';
import { reviewRevisionKey, type MemberQuery, type ReviewKind, type ReviewQuery, type ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import { AnalysisConflict, AnalysisNotFound, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';
import type { Decision, Review, ReviewMember, ReviewQueueItem, ReviewWindow, ReviewContext, ReviewBatch, ReviewListFilter, ReviewQueueFilter } from '@sidechannel/contracts/analysis/jev-reviews';
import { jsonHash } from '../hashing.js';

const hash = jsonHash;

const text = (value: unknown, name: string, max = 200) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AnalysisValidation(`Invalid ${name}`); return value.trim(); };

const strings = (value: unknown, name: string) => { if (!Array.isArray(value) || value.length > 10000 || value.some(x => typeof x !== 'string')) throw new AnalysisValidation(`Invalid ${name}`); return [...new Set(value as string[])]; };


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
        const population = [...ctx.windows].sort((a, b) => a.id.localeCompare(b.id)), rank = (id: string) => hash([seed, id]);
        const random = new Set([...population].sort((a, b) => rank(a.id).localeCompare(rank(b.id))).slice(0, Number(randomSize)).map(w => w.id));
        const members: ReviewMember[] = population.map(window => {
            const reasons: ('flagged' | 'random' | 'manual')[] = [];
            if (codeIds.some(code => window.probabilities[code] != null && window.probabilities[code]! >= threshold)) reasons.push('flagged');
            if (random.has(window.id)) reasons.push('random'); if (manual.includes(window.id)) reasons.push('manual');
            return { windowId: window.id, eligible: true, selected: reasons.length > 0, reasons, order: hash(['order', seed, window.id]) };
        });
        const batch: ReviewBatch = { id: randomUUID(), analysisId, createdAt: new Date().toISOString(), definitionRevision: ctx.definitionRevision, evidenceRevision: ctx.evidenceRevision, populationHash: hash(population.map(w => w.id)), populationSize: population.length, seed, randomSize: Number(randomSize), threshold, codeIds, selectedCount: members.filter(m => m.selected).length, mode: input.mode === 'blind' ? 'blind' : 'assisted' };
        for (const member of members) await this.store.insert('members', batch.id, member.order + ':' + member.windowId, member);
        await this.store.insert('batches', analysisId, batch.id, batch); return batch;
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
        const { threshold, codeIds, seed, ...publicBatch } = batch; return { batch: blind ? publicBatch : batch, items, nextCursor: page.nextCursor };
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
