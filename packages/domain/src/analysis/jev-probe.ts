import { createHash } from 'node:crypto';
import type { ProbeConfiguration } from '@sidechannel/contracts/analysis/evidence-contracts';
import type { AnalysisAnswer, AnalysisReliability, AnalysisResult } from '@sidechannel/contracts/analysis/jev-repository';

/** A window the probe may re-score, with the size used to stratify the sample. */
export interface ProbeCandidate { id: string; estimatedTokens: number; }

function seededRandom(seed: string): () => number {
    let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
    return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/**
 * Seeded stratified sample of probe windows (spec section 6). Candidates are ordered by estimated tokens and cut into
 * `probe.windows` contiguous strata of near-equal count; one window is drawn per stratum, so small and large windows
 * are both probed. The same candidates, settings and seed always give the same selection, returned in window order.
 */
export function selectProbeWindows(candidates: readonly ProbeCandidate[], probe: Pick<ProbeConfiguration, 'windows' | 'seed'>): string[] {
    if (candidates.length <= probe.windows) return candidates.map(candidate => candidate.id);
    const ordered = [...candidates].sort((a, b) => a.estimatedTokens - b.estimatedTokens || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const random = seededRandom(`probe\u0000${probe.seed}`), chosen = new Set<string>();
    for (let stratum = 0; stratum < probe.windows; stratum++) {
        const from = Math.floor(stratum * ordered.length / probe.windows), to = Math.floor((stratum + 1) * ordered.length / probe.windows);
        chosen.add(ordered[from + Math.floor(random() * (to - from))]!.id);
    }
    return candidates.filter(candidate => chosen.has(candidate.id)).map(candidate => candidate.id);
}

/**
 * The scalar a repeat series is measured on: the probability for `noul`, the expected score for `score`, and
 * the reported confidence in the selected label for `choice`.
 */
export function answerScalar(result: Pick<AnalysisResult, 'probability' | 'answer'>): number | undefined {
    const answer: AnalysisAnswer | undefined = result.answer;
    if (!answer) return result.probability ?? undefined;
    return answer.type === 'noul' ? answer.probability : answer.type === 'score' ? answer.score : answer.confidence;
}

const mean = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0) / values.length;

/** Sample standard deviation (n - 1). One value has no spread to measure and gives 0. */
export function sampleSd(values: readonly number[]): number {
    if (values.length < 2) return 0;
    const m = mean(values);
    return Math.sqrt(values.reduce((total, value) => total + (value - m) ** 2, 0) / (values.length - 1));
}

/**
 * Repeat-variance summary from probe results. A series is one (window, code, actor) answered several times; its sd
 * is the sample standard deviation of the repeats and its spread is max minus min. Per code, `sd` is the mean series
 * sd, `maxSpread` the largest series spread and `n` the number of series. Overall, `meanSd` is the mean over all
 * series (the brief's "mean standard deviation across code-window pairs") and `maxSd` the largest series sd.
 */
export function computeReliability(results: readonly Pick<AnalysisResult, 'windowId' | 'codeId' | 'actorId' | 'probability' | 'answer'>[], repeats: number, completedAt: string): AnalysisReliability {
    const series = new Map<string, { codeId: string; windowId: string; values: number[] }>();
    for (const result of results) {
        const value = answerScalar(result); if (value === undefined || !Number.isFinite(value)) continue;
        const key = `${result.windowId}\u0000${result.codeId}\u0000${result.actorId ?? ''}`;
        const entry = series.get(key) ?? { codeId: result.codeId, windowId: result.windowId, values: [] };
        entry.values.push(value); series.set(key, entry);
    }
    const perCode: AnalysisReliability['perCode'] = {}, byCode = new Map<string, { sds: number[]; spread: number }>();
    for (const { codeId, values } of series.values()) {
        const entry = byCode.get(codeId) ?? { sds: [], spread: 0 };
        entry.sds.push(sampleSd(values)); entry.spread = Math.max(entry.spread, Math.max(...values) - Math.min(...values)); byCode.set(codeId, entry);
    }
    for (const [codeId, entry] of byCode) perCode[codeId] = { sd: mean(entry.sds), maxSpread: entry.spread, n: entry.sds.length };
    const sds = [...byCode.values()].flatMap(entry => entry.sds);
    return { perCode, overall: { meanSd: sds.length ? mean(sds) : 0, maxSd: sds.length ? Math.max(...sds) : 0, probedWindows: new Set([...series.values()].map(entry => entry.windowId)).size, repeats }, completedAt };
}
