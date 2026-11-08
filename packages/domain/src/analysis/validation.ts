import type { AnalysisJob, AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';
import type { CodeValidation, Decision, Review, ValidationStatus } from '@sidechannel/contracts/analysis/jev-reviews';
import type { ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import { iteratePages } from '../pagination.js';

/**
 * Cut points for the validation status table (v2 spec section 9.3). They are literature defaults for a different
 * task and are meant to move once enough labels exist, so they live here and nowhere else.
 */
export interface ValidationConfig {
    /** Fixed threshold at which precision, recall, F1 and human-model kappa are reported. */
    fixedThreshold: number;
    /** `unvalidated` below either count. */
    minLabels: number; minPositives: number;
    /** `unreliable` below this kappa; `tentative` from here up to `validatedKappa`. */
    unreliableKappa: number; validatedKappa: number;
    /** `validated` additionally needs this many labels and positives. */
    validatedMinLabels: number; validatedMinPositives: number;
    /** `unreliable` when the F1-optimal threshold lies within one noise floor of this value. */
    optimalThresholdCentre: number;
    /** `unreliable` when precision at the fixed threshold (the flagged windows) is below this. */
    minFlaggedPrecision: number;
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
    fixedThreshold: 0.7, minLabels: 20, minPositives: 5, unreliableKappa: 0.4, validatedKappa: 0.67,
    validatedMinLabels: 30, validatedMinPositives: 8, optimalThresholdCentre: 0.5, minFlaggedPrecision: 0.6,
};

/** One reviewed (analysis, window, code): the primary score and each reviewer's latest decision. */
export interface LabelledWindow { analysisId: string; windowId: string; codeId: string; score: number | null; decisions: { reviewer: string; decision: Decision }[] }

export interface ValidationInput { definitionRevision: string; model: string; codeIds: string[]; windows: LabelledWindow[]; noiseFloors: Record<string, number | null> }

export interface ThresholdMetrics { threshold: number; precision: number | null; recall: number | null; f1: number | null }

/**
 * `CodeValidation` carries the metrics at the fixed threshold. The F1-optimal operating point and the number of
 * windows whose reviewers split between present and absent (excluded from every model metric) ride along.
 */
export interface CodeValidationMetrics extends CodeValidation { fixed: ThresholdMetrics; optimal: ThresholdMetrics | null; contested: number }

export interface DisagreementRow { analysisId: string; windowId: string; codeId: string; score: number; label: 0 | 1; gap: number; decisions: LabelledWindow['decisions'] }

export interface CodeDisagreements { codeId: string; modelHighHumanAbsent: DisagreementRow[]; modelLowHumanPresent: DisagreementRow[] }

type Consensus = 'present' | 'absent' | 'uncertain' | 'contested' | null;

/** Majority of the present and absent decisions; a tie is contested; uncertain only when nobody decided. */
export function consensus(decisions: readonly { decision: Decision }[]): Consensus {
    const present = decisions.filter(d => d.decision === 'present').length, absent = decisions.filter(d => d.decision === 'absent').length;
    if (present > absent) return 'present'; if (absent > present) return 'absent'; if (present > 0) return 'contested';
    return decisions.some(d => d.decision === 'uncertain') ? 'uncertain' : null;
}

/** Cohen's kappa over rating pairs; null with no pairs or when chance agreement is certain (kappa undefined). */
export function cohenKappa(pairs: readonly (readonly [boolean, boolean])[]): number | null {
    const n = pairs.length; if (n === 0) return null;
    const agree = pairs.filter(([a, b]) => a === b).length / n, a1 = pairs.filter(([a]) => a).length / n, b1 = pairs.filter(([, b]) => b).length / n;
    const chance = a1 * b1 + (1 - a1) * (1 - b1);
    return chance === 1 ? null : (agree - chance) / (1 - chance);
}

function thresholdMetrics(rows: readonly { label: boolean; score: number }[], threshold: number): ThresholdMetrics {
    let tp = 0, fp = 0, fn = 0;
    for (const { label, score } of rows) { const flagged = score >= threshold; if (flagged && label) tp++; else if (flagged) fp++; else if (label) fn++; }
    const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
    return { threshold, precision, recall, f1: precision === null || recall === null ? null : precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall) };
}

/** Highest F1 over the distinct observed scores as thresholds (`score >= t`); ties resolve to the lowest threshold. */
export function optimalThreshold(rows: readonly { label: boolean; score: number }[]): ThresholdMetrics | null {
    if (!rows.some(r => r.label)) return null;
    let best: ThresholdMetrics | null = null;
    for (const t of [...new Set(rows.map(r => r.score))].sort((a, b) => a - b)) { const m = thresholdMetrics(rows, t); if ((m.f1 ?? -1) > (best?.f1 ?? -1)) best = m; }
    return best;
}

/** Derives the status and the reasons that fired, in table order (spec section 9.3). */
export function deriveStatus(m: Pick<CodeValidationMetrics, 'labels' | 'positives' | 'kappaHumanModel' | 'noiseFloor' | 'optimalThreshold'> & { precision: number | null }, config: ValidationConfig): { status: ValidationStatus; reasons: string[] } {
    const reasons: string[] = [];
    if (m.labels < config.minLabels) reasons.push(`${m.labels} labels, need ${config.minLabels}`);
    if (m.positives < config.minPositives) reasons.push(`${m.positives} positives, need ${config.minPositives}`);
    if (m.kappaHumanModel === null) reasons.push('human-model kappa is undefined');
    if (reasons.length) return { status: 'unvalidated', reasons };
    const kappa = m.kappaHumanModel!;
    if (kappa < config.unreliableKappa) reasons.push(`kappa ${kappa.toFixed(2)} is below ${config.unreliableKappa}`);
    if (m.optimalThreshold !== null && m.noiseFloor !== null && Math.abs(m.optimalThreshold - config.optimalThresholdCentre) <= m.noiseFloor + 1e-9)
        reasons.push(`F1-optimal threshold ${m.optimalThreshold.toFixed(2)} is within the noise floor ${m.noiseFloor.toFixed(2)} of ${config.optimalThresholdCentre}`);
    if (m.precision !== null && m.precision < config.minFlaggedPrecision) reasons.push(`precision on flagged windows ${m.precision.toFixed(2)} is below ${config.minFlaggedPrecision}`);
    if (reasons.length) return { status: 'unreliable', reasons };
    if (kappa < config.validatedKappa) return { status: 'tentative', reasons: [`kappa ${kappa.toFixed(2)} is below ${config.validatedKappa}`] };
    if (m.labels < config.validatedMinLabels || m.positives < config.validatedMinPositives)
        return { status: 'tentative', reasons: [`validated needs ${config.validatedMinLabels} labels and ${config.validatedMinPositives} positives; have ${m.labels} and ${m.positives}`] };
    return { status: 'validated', reasons: [] };
}

/** Per-code validation for one (codebook revision, model version) pair. */
export function computeValidation(input: ValidationInput, config: ValidationConfig = DEFAULT_VALIDATION_CONFIG): CodeValidationMetrics[] {
    return input.codeIds.map(codeId => {
        const windows = input.windows.filter(w => w.codeId === codeId);
        let uncertain = 0, contested = 0; const scored: { label: boolean; score: number }[] = [], decided: LabelledWindow[] = [];
        for (const w of windows) {
            const c = consensus(w.decisions);
            if (c === 'uncertain') uncertain++; else if (c === 'contested') contested++;
            if (c === 'present' || c === 'absent') { decided.push(w); if (w.score !== null) scored.push({ label: c === 'present', score: w.score }); }
        }
        const fixed = thresholdMetrics(scored, config.fixedThreshold), optimal = optimalThreshold(scored);
        const kappaHumanModel = cohenKappa(scored.map(r => [r.label, r.score >= config.fixedThreshold] as const));
        // Human-human: every reviewer pair on a window, ordered by reviewer name so the first rater is stable.
        const pairs: (readonly [boolean, boolean])[] = [];
        for (const w of windows) {
            const raters = w.decisions.filter(d => d.decision !== 'uncertain').sort((a, b) => a.reviewer.localeCompare(b.reviewer));
            for (let i = 0; i < raters.length; i++) for (let j = i + 1; j < raters.length; j++) pairs.push([raters[i]!.decision === 'present', raters[j]!.decision === 'present']);
        }
        const positives = scored.filter(r => r.label).length, noiseFloor = input.noiseFloors[codeId] ?? null;
        const labels = scored.length, base = { labels, positives, kappaHumanModel, noiseFloor, optimalThreshold: optimal?.threshold ?? null, precision: fixed.precision };
        const { status, reasons } = deriveStatus(base, config);
        if (contested) reasons.push(`${contested} contested windows excluded`);
        return {
            codeId, definitionRevision: input.definitionRevision, model: input.model, status, labels, positives, negatives: labels - positives, uncertain,
            reviewers: new Set(windows.flatMap(w => w.decisions.map(d => d.reviewer))).size,
            precision: fixed.precision, recall: fixed.recall, f1: fixed.f1, optimalThreshold: optimal?.threshold ?? null,
            kappaHumanModel, kappaHumanHuman: cohenKappa(pairs), noiseFloor, reasons, fixed, optimal, contested,
        };
    });
}

/** Labelled windows with the largest gap between label (present 1, absent 0) and score, split by which side is wrong. */
export function computeDisagreements(input: Pick<ValidationInput, 'windows'>, codeId: string, limit = 50): CodeDisagreements {
    const rows: DisagreementRow[] = [];
    for (const w of input.windows) {
        if (w.codeId !== codeId || w.score === null) continue;
        const c = consensus(w.decisions); if (c !== 'present' && c !== 'absent') continue;
        const label = c === 'present' ? 1 : 0;
        rows.push({ analysisId: w.analysisId, windowId: w.windowId, codeId, score: w.score, label, gap: Math.abs(label - w.score), decisions: w.decisions });
    }
    const order = (a: DisagreementRow, b: DisagreementRow) => b.gap - a.gap || a.analysisId.localeCompare(b.analysisId) || a.windowId.localeCompare(b.windowId);
    rows.sort(order);
    return { codeId, modelHighHumanAbsent: rows.filter(r => r.label === 0).slice(0, limit), modelLowHumanPresent: rows.filter(r => r.label === 1).slice(0, limit) };
}

/**
 * Loads the labelled set for a (revision, model) pair through the repository interfaces: every analysis whose
 * manifest froze that revision under that model contributes its primary scores and the window-scope reviews
 * stored against it. Probe results are ignored; an actor-scoped code keeps its highest actor score.
 */
export async function loadValidationInput(analyses: Pick<AnalysisRepository, 'listAllJobs' | 'listResults'>, reviews: ReviewStore, definitionRevision: string, model: string, codeIds: string[]): Promise<ValidationInput> {
    const windows: LabelledWindow[] = [], floors: Record<string, number | null> = Object.fromEntries(codeIds.map(id => [id, null]));
    const matching: AnalysisJob[] = [];
    for await (const job of iteratePages(options => analyses.listAllJobs(options), 500)) if (job.manifest.codebook.id === definitionRevision && job.manifest.settings.model === model) matching.push(job);
    for (const job of matching) {
        for (const codeId of codeIds) { const sd = job.reliability?.perCode[codeId]?.sd; if (sd !== undefined) floors[codeId] = Math.max(floors[codeId] ?? 0, sd); }
        const scores = new Map<string, number | null>();
        for await (const result of iteratePages(options => analyses.listResults(job.id, options), 500)) {
            if (result.probe || !codeIds.includes(result.codeId)) continue;
            const key = JSON.stringify([result.windowId, result.codeId]), prior = scores.get(key);
            scores.set(key, result.actorId && prior != null && result.probability != null ? Math.max(prior, result.probability) : result.probability);
        }
        const decisions = new Map<string, LabelledWindow>(); let after: string | undefined;
        do {
            const page = await reviews.queryReviews<Review>(job.id, { scope: 'window', latest: true, definitionRevision }, after, 500);
            for (const { value: r } of page.items) {
                if (!codeIds.includes(r.codeId)) continue;
                const key = JSON.stringify([r.subjectId, r.codeId]);
                const entry = decisions.get(key) ?? { analysisId: job.id, windowId: r.subjectId, codeId: r.codeId, score: scores.get(key) ?? null, decisions: [] };
                entry.decisions.push({ reviewer: r.reviewer, decision: r.decision }); decisions.set(key, entry);
            }
            after = page.nextCursor ?? undefined;
        } while (after);
        windows.push(...decisions.values());
    }
    return { definitionRevision, model, codeIds, windows, noiseFloors: floors };
}
