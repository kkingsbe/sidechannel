import { randomUUID } from 'node:crypto';
import {
    DEFAULT_BOOTSTRAP_ITERATIONS, DEFAULT_CONFIDENCE, DEFAULT_K_STRIKES, COMPARISON_METRICS,
    type AnalysisSummary, type Comparison, type ComparisonInput, type ComparisonMetric, type ComparisonRequest, type ComparisonStore, type FixedThresholds, type ThresholdPolicy,
} from '@sidechannel/contracts/analysis/aggregation';
import {
    AnalysisNotFound, AnalysisValidation, isActiveJob,
    type AnalysisJob, type JobLifecycleStore, type Page, type PageOptions, type ResultStore, type WindowStore,
} from '@sidechannel/contracts/analysis/jev-repository';
import type { Repository } from '@sidechannel/contracts/harness/server';
import { compareSummaries, parseThresholdPolicy, policyKey, resolveThresholds, summarize, windowScoreSeries, type AggregationData } from './aggregation.js';

/** Thresholds chosen by the validation loop (spec 9.3), keyed by code ID. Absent codes use the policy's marked fallback. */
export type ValidatedThresholdSource = (job: AnalysisJob) => Promise<Record<string, FixedThresholds>>;

export interface AggregationPorts {
    jobs: Pick<JobLifecycleStore, 'getJob'>;
    windows: Pick<WindowStore, 'listWindows'>;
    results: Pick<ResultStore, 'listResults'>;
    /** Source runs, for the condition tag and `pairId`. */
    runs: Pick<Repository, 'getRun'>;
    comparisons: ComparisonStore;
    validated?: ValidatedThresholdSource;
    now?: () => Date;
    newId?: () => string;
}

const MAX_ANALYSES = 200;

/** Fully drains a cursor-paged store listing. */
async function drain<T>(fetch: (page: PageOptions) => Promise<Page<T>>): Promise<T[]> {
    const items: T[] = []; let after: string | undefined;
    do { const page = await fetch({ limit: 500, ...(after ? { after } : {}) }); items.push(...page.items); after = page.nextCursor ?? undefined; } while (after);
    return items;
}

const integer = (value: unknown, name: string, fallback: number, min: number, max: number): number => {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new AnalysisValidation(`${name} must be an integer from ${min} to ${max}`);
    return value;
};

/**
 * Loads windows and results through the existing repository interfaces, computes the section 8 read models and
 * persists comparisons. Summaries are cached in memory by analysis, threshold policy and k; an entry is reused only
 * while the job it was computed from (and every control job) is terminal and unchanged.
 */
export class AnalysisAggregationService {
    private cache = new Map<string, { fingerprint: string; summary: AnalysisSummary }>();
    constructor(private ports: AggregationPorts) {}

    private now() { return (this.ports.now?.() ?? new Date()).toISOString(); }

    private async job(id: string): Promise<AnalysisJob> {
        const job = await this.ports.jobs.getJob(id);
        if (!job) throw new AnalysisNotFound('Analysis not found');
        return job;
    }

    private async load(job: AnalysisJob): Promise<AggregationData> {
        const [windows, results] = await Promise.all([drain(page => this.ports.windows.listWindows(job.id, page)), drain(page => this.ports.results.listResults(job.id, page))]);
        return { windows, results, definitions: job.manifest.codebook.definitions, ...(job.reliability ? { reliability: job.reliability } : {}) };
    }

    private fingerprint(job: AnalysisJob): string { return [job.status, job.updatedAt, job.counters.finishedWindows, job.counters.returnedAnswers, job.reliability?.completedAt ?? ''].join('|'); }

    /** Section 8.1 metrics under a threshold policy. */
    async summary(analysisId: string, policy: ThresholdPolicy = parseThresholdPolicy(undefined), k = DEFAULT_K_STRIKES): Promise<AnalysisSummary> {
        if (!Number.isInteger(k) || k < 1 || k > 1000) throw new AnalysisValidation('k must be an integer from 1 to 1000');
        const job = await this.job(analysisId), controlJobs = policy.kind === 'control-percentile' ? await this.controls(job, policy.controlAnalysisIds) : [];
        const fingerprint = [job, ...controlJobs].map(j => this.fingerprint(j)).join('/'), key = `${analysisId}|${policyKey(policy)}|${k}`, cached = this.cache.get(key);
        if (cached && cached.fingerprint === fingerprint) return structuredClone(cached.summary);
        const data = await this.load(job), definitions = data.definitions;
        const controlScores: Record<string, number[]> = {};
        for (const control of controlJobs) for (const [codeId, scores] of Object.entries(windowScoreSeries(await this.load(control)))) controlScores[codeId] = [...controlScores[codeId] ?? [], ...scores];
        const validated = policy.kind === 'validated' ? await this.ports.validated?.(job) : undefined;
        const summary = summarize(data, {
            analysisId, runId: job.runId, codebookRevisionId: job.manifest.codebook.id, model: job.manifest.settings.model, policy, k,
            thresholds: resolveThresholds(policy, definitions, controlScores, validated), controlAnalysisIds: controlJobs.map(c => c.id).sort(), computedAt: this.now(),
        });
        if (![job, ...controlJobs].some(j => isActiveJob(j.status))) this.cache.set(key, { fingerprint, summary: structuredClone(summary) });
        return summary;
    }

    /** Control analyses must be finished and share the target's codebook revision and model (spec 8.2). */
    private async controls(target: AnalysisJob, ids: string[]) {
        const found: AnalysisJob[] = [];
        for (const id of [...new Set(ids)].sort()) {
            const job = await this.job(id);
            if (job.status !== 'completed' && job.status !== 'partial') throw new AnalysisValidation(`Control analysis ${id} has not completed`);
            if (job.manifest.codebook.id !== target.manifest.codebook.id || job.manifest.settings.model !== target.manifest.settings.model) throw new AnalysisValidation(`Control analysis ${id} must use the same codebook revision and model`);
            found.push(job);
        }
        return found;
    }

    /** Section 8.3: tags each analysis with its run's condition and pair, summarizes under one policy, bootstraps over runs and stores the result. */
    async createComparison(request: ComparisonRequest): Promise<Comparison> {
        const ids = request.analysisIds;
        if (!Array.isArray(ids) || !ids.length || ids.length > MAX_ANALYSES || ids.some(id => typeof id !== 'string' || !id)) throw new AnalysisValidation(`analysisIds must list 1 to ${MAX_ANALYSES} analysis IDs`);
        if (new Set(ids).size !== ids.length) throw new AnalysisValidation('analysisIds must not repeat');
        const policy = parseThresholdPolicy(request.policy), metric = request.metric ?? 'max';
        if (!COMPARISON_METRICS.includes(metric as ComparisonMetric)) throw new AnalysisValidation(`metric must be one of ${COMPARISON_METRICS.join(', ')}`);
        const seed = integer(request.seed, 'seed', 1, 0, 0xffffffff), iterations = integer(request.iterations, 'iterations', DEFAULT_BOOTSTRAP_ITERATIONS, 100, 20000), k = integer(request.k, 'k', DEFAULT_K_STRIKES, 1, 1000);
        const confidence = request.confidence ?? DEFAULT_CONFIDENCE;
        if (typeof confidence !== 'number' || !(confidence > 0 && confidence < 1)) throw new AnalysisValidation('confidence must be between 0 and 1');
        const inputs: ComparisonInput[] = [], summaries = new Map<string, AnalysisSummary>();
        for (const analysisId of ids) {
            const job = await this.job(analysisId), run = await this.ports.runs.getRun(job.runId);
            if (!run) throw new AnalysisNotFound(`Source run ${job.runId} not found`);
            if (inputs.some(i => i.runId === job.runId)) throw new AnalysisValidation('Each run may appear once: windows and analyses of one run are not independent samples');
            inputs.push({ analysisId, runId: job.runId, condition: run.config.condition.id, ...(run.pairId ? { pairId: run.pairId } : {}) });
            summaries.set(analysisId, await this.summary(analysisId, policy, k));
        }
        const paired = request.paired === true, compared = compareSummaries(inputs, summaries, { metric, seed, iterations, confidence, paired, ...(request.baseline ? { baseline: request.baseline } : {}) });
        const comparison: Comparison = {
            id: (this.ports.newId ?? randomUUID)(), createdAt: this.now(), ...(request.creator ? { creator: request.creator } : {}),
            inputs, runIds: inputs.map(i => i.runId), policy, metric, seed, iterations, confidence, baseline: compared.baseline, paired, k,
            controlAnalysisIds: compared.controlAnalysisIds, codes: compared.codes, warnings: compared.warnings,
        };
        await this.ports.comparisons.putComparison(comparison);
        return comparison;
    }

    async getComparison(id: string): Promise<Comparison> {
        const found = await this.ports.comparisons.getComparison(id);
        if (!found) throw new AnalysisNotFound('Comparison not found');
        return found;
    }

    listComparisons(runId?: string, page?: PageOptions): Promise<Page<Comparison>> { return this.ports.comparisons.listComparisons(runId ? { runId } : {}, page); }
}
