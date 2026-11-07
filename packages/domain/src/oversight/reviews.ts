import { z } from 'zod';
import { allRecords, hash, timestamp } from '../analysis/store.js';
import type { ResearchStore } from '@sidechannel/contracts/analysis/store';
import type { MonitorDefinition } from '@sidechannel/contracts/oversight/contracts';
import { currentDefinition } from './definition.js';
import { OversightError } from './errors.js';
import { readEvents, type OversightSource } from './events.js';
import type { RunReviewContext, RunOutcomeReview, RunOutcomeAgreement } from '@sidechannel/contracts/oversight/reviews';

const reviewInput = z.object({
    reviewer: z.string().trim().min(1).max(200), outcomeId: z.string().min(1).max(200),
    definitionRevisionId: z.string().min(1).max(200), evidenceRevision: z.string().regex(/^[0-9a-f]{64}$/),
    decision: z.enum(['present', 'absent', 'uncertain']), rationale: z.string().trim().min(1).max(24000),
    eventIds: z.array(z.string().min(1).max(300)).max(1000).default([]), supersedesId: z.string().max(1000).optional(),
}).strict();

export const normalizedReviewer = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase('en-US');

async function sourceSnapshot(repository: OversightSource, runId: string) {
    const run = await repository.getRun(runId);
    if (!run) throw new OversightError(404, 'Run not found');
    if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) throw new OversightError(409, 'Run outcome review requires a terminal source run');
    const events = (await readEvents(repository, runId)).sort((a, b) => a.sequence - b.sequence);
    // Include actor reports and artifact/board projections as well as the actual event bytes.
    // A config hash alone cannot identify the evidence that two people reviewed.
    const evidenceRevision = hash({ version: 'run-review-source-v1', runId, configHash: run.configHash,
        status: run.status, events, reports: run.reports, artifacts: run.artifacts, board: run.board });
    return { run, events, evidenceRevision };
}

export async function runReviewContext(repository: OversightSource, store: ResearchStore, runId: string, definitionRevisionId?: string): Promise<RunReviewContext> {
    const source = await sourceSnapshot(repository, runId);
    const definition = definitionRevisionId ? await store.get<MonitorDefinition>('monitor_definitions', definitionRevisionId) : await currentDefinition(store);
    if (!definition) throw new OversightError(404, 'Monitor definition revision not found');
    return { runId, evidenceRevision: source.evidenceRevision, definition, sourceStatus: source.run.status,
        eventCount: source.events.length, sequenceBoundary: source.events.at(-1)?.sequence ?? 0 };
}

function latestReviews(history: RunOutcomeReview[]) {
    const byReviewer = new Map<string, RunOutcomeReview>();
    for (const review of [...history].sort((a, b) => a.sequence - b.sequence)) byReviewer.set(review.reviewerKey, review);
    return [...byReviewer.values()];
}

function agreement(history: RunOutcomeReview[], evidenceRevision?: string, definitionRevisionId?: string): RunOutcomeAgreement {
    const latest = latestReviews(history), first = latest[0]!;
    const epoch = Math.max(...history.map(review => review.agreementEpoch));
    const sameEvidence = latest.every(review => review.evidenceRevision === first.evidenceRevision);
    const sameDecision = latest.every(review => review.decision === first.decision);
    const currentConfirmations = latest.filter(review => review.agreementEpoch === epoch);
    const state = !sameDecision || !sameEvidence ? 'disagreement'
        : latest.length >= 2 && currentConfirmations.length === latest.length ? 'agreed' : 'provisional';
    return { outcomeId: first.outcomeId, definitionRevisionId: first.definitionRevisionId,
        evidenceRevision: sameEvidence ? first.evidenceRevision : null, state, decision: state === 'agreed' ? first.decision : null,
        reviewIds: latest.map(review => review.id), agreementEpoch: epoch,
        sourceMatches: sameEvidence && first.evidenceRevision === evidenceRevision,
        definitionCurrent: first.definitionRevisionId === definitionRevisionId };
}

export async function saveRunOutcomeReview(repository: OversightSource, store: ResearchStore, runId: string, input: unknown): Promise<RunOutcomeReview> {
    const parsed = reviewInput.parse(input), source = await sourceSnapshot(repository, runId);
    if (parsed.evidenceRevision !== source.evidenceRevision) throw new OversightError(409, 'Source evidence changed; reload review context before judging');
    const definition = await store.get<MonitorDefinition>('monitor_definitions', parsed.definitionRevisionId);
    const outcome = definition?.outcomes.find(item => item.id === parsed.outcomeId && !item.archived);
    if (!definition || !outcome) throw new OversightError(400, 'Outcome must be enabled in the named immutable definition revision');
    const evidenceIds = new Set(source.events.map(event => event.id));
    if (new Set(parsed.eventIds).size !== parsed.eventIds.length || parsed.eventIds.some(id => !evidenceIds.has(id))) throw new OversightError(400, 'Citations must be unique event IDs from this source run');
    if (parsed.decision === 'present' && !parsed.eventIds.length) throw new OversightError(400, 'A present outcome requires supporting source event citations');
    const reviewerKey = normalizedReviewer(parsed.reviewer);
    const history = await allRecords<RunOutcomeReview>(store, 'run_outcome_reviews', { runId, outcomeId: parsed.outcomeId, definitionRevisionId: definition.id });
    const previous = latestReviews(history).find(review => review.reviewerKey === reviewerKey);
    if (previous?.id !== parsed.supersedesId) throw new OversightError(409, previous ? 'Supply supersedesId for your latest review revision' : 'Superseded review does not match this reviewer and outcome');
    const sequence = history.reduce((max, review) => Math.max(max, review.sequence), 0) + 1;
    const priorAgreement = history.length ? agreement(history) : null;
    // Revising any agreed judgment starts a new confirmation epoch, even if its verdict
    // is unchanged. Reconfirmation while provisional joins that epoch without resetting it.
    const agreementEpoch = priorAgreement ? priorAgreement.agreementEpoch + (previous && priorAgreement.state === 'agreed' ? 1 : 0) : 1;
    const review: RunOutcomeReview = { id: `${hash([runId, parsed.outcomeId, definition.id])}:${String(sequence).padStart(12, '0')}`,
        revision: (previous?.revision ?? 0) + 1, createdAt: timestamp(), ...parsed, runId, reviewerKey, identityVerified: false,
        sequence, agreementEpoch, outcomeDefinition: structuredClone(outcome) };
    // The immutable sequence key is the concurrency check: competing saves cannot both
    // publish the same next revision. Losing writers reload instead of creating a branch.
    if (!await store.insert('run_outcome_reviews', review)) throw new OversightError(409, 'A concurrent review was saved; reload history and retry');
    return review;
}

export async function runOutcomeAgreements(repository: OversightSource, store: ResearchStore, runId: string): Promise<RunOutcomeAgreement[]> {
    const context = await runReviewContext(repository, store, runId);
    const rows = await allRecords<RunOutcomeReview>(store, 'run_outcome_reviews', { runId });
    return agreementsFrom(rows, context);
}

function agreementsFrom(rows: RunOutcomeReview[], context: RunReviewContext): RunOutcomeAgreement[] {
    const groups = new Map<string, RunOutcomeReview[]>();
    for (const row of rows) { const key = JSON.stringify([row.outcomeId, row.definitionRevisionId]); groups.set(key, [...groups.get(key) ?? [], row]); }
    return [...groups.values()].map(history => agreement(history, context.evidenceRevision, context.definition.id));
}

export async function latestRunOutcomeReview(repository: OversightSource, store: ResearchStore, runId: string, input: { reviewer: string; outcomeId: string; definitionRevisionId: string }) {
    const reviewer = z.string().trim().min(1).max(200).parse(input.reviewer);
    const context = await runReviewContext(repository, store, runId, input.definitionRevisionId);
    if (!context.definition.outcomes.some(outcome => outcome.id === input.outcomeId)) throw new OversightError(400, 'Unknown outcome in this definition revision');
    const rows = await allRecords<RunOutcomeReview>(store, 'run_outcome_reviews', { runId, outcomeId: input.outcomeId, definitionRevisionId: input.definitionRevisionId, reviewerKey: normalizedReviewer(reviewer) });
    return rows.sort((a, b) => a.sequence - b.sequence).at(-1) ?? null;
}

export async function exportRunOutcomeReviews(repository: OversightSource, store: ResearchStore, runId: string, definitionRevisionId?: string) {
    const context = await runReviewContext(repository, store, runId, definitionRevisionId);
    const current = await currentDefinition(store);
    const reviews = await allRecords<RunOutcomeReview>(store, 'run_outcome_reviews', { runId });
    const ids = [...new Set([context.definition.id, ...reviews.map(review => review.definitionRevisionId)])];
    const definitions = await Promise.all(ids.map(id => store.get<MonitorDefinition>('monitor_definitions', id)));
    return { schemaVersion: 1, scope: 'human run outcomes: complete append-only review history, referenced definition revisions, exact source fingerprint, and agreement states; full source evidence is a separate linked dataset', exportedAt: timestamp(),
        sourceExport: `/api/runs/${encodeURIComponent(runId)}/export`, context, currentDefinitionRevisionId: current.id, definitions: definitions.filter(definition => definition !== null), reviews, agreements: agreementsFrom(reviews, { ...context, definition: current }) };
}