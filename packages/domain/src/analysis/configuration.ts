import type { Run } from '@sidechannel/contracts/harness/contracts';
import { ANALYSIS_PRESETS, EVIDENCE_CATEGORIES, type AnalysisConfiguration, type AnalysisConfigurationInput } from '@sidechannel/contracts/analysis/evidence-contracts';
import { canonicalHash, canonicalJson } from '../hashing.js';
import { DEFAULT_TOKEN_ESTIMATOR_VERSION, isTokenEstimatorVersion } from './token-estimator.js';

export const stableStringify = canonicalJson;
export const snapshotHash = canonicalHash;

export function immutableSnapshot<T>(value: T): T {
    const copy = structuredClone(value);
    const freeze = (v: unknown): void => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } };
    freeze(copy); return copy;
}

function integer(value: number, name: string, maximum: number): void { if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`); }

function allowedKeys(value: unknown, allowed: readonly string[], name: string): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${name} setting: ${key}`);
}

export function resolveAnalysisConfiguration(input: AnalysisConfigurationInput = {}): AnalysisConfiguration {
    allowedKeys(input, ['version', 'model', 'window', 'selection', 'evidence', 'inputLimits', 'concurrency', 'timeoutMs', 'maxAttempts', 'retryBaseMs', 'longContext', 'preset', 'probe'], 'analysis');
    if (input.probe !== undefined && input.probe !== null) allowedKeys(input.probe, ['windows', 'repeats', 'seed'], 'probe');
    if (input.preset !== undefined && !ANALYSIS_PRESETS.includes(input.preset)) throw new Error('Unknown analysis preset');
    const { probe: probeInput, preset, ...rest } = input;
    if (input.window !== undefined) allowedKeys(input.window, ['size', 'stride'], 'window');
    if (input.selection !== undefined) allowedKeys(input.selection, ['phases', 'startOrdinal', 'endOrdinal'], 'selection');
    if (input.evidence !== undefined) allowedKeys(input.evidence, EVIDENCE_CATEGORIES, 'evidence');
    if (input.inputLimits !== undefined) allowedKeys(input.inputLimits, ['singleQuestionTokens', 'combinedQuestionTokens', 'maxBodyBytes', 'headroomTokens', 'estimatorVersion'], 'input limit');
    const config: AnalysisConfiguration = {
        version: 1, model: 'jev-1.14.0', concurrency: 2, timeoutMs: 120_000, maxAttempts: 3, retryBaseMs: 1_000,
        ...rest, longContext: false,
        ...(preset !== undefined ? { preset } : {}),
        ...(probeInput ? { probe: { windows: 6, repeats: 4, seed: 'probe-v1', ...probeInput } } : {}),
        window: { size: 12, stride: 4, ...input.window },
        selection: { phases: ['action', 'report'], ...input.selection },
        evidence: { ...Object.fromEntries(EVIDENCE_CATEGORIES.map(c => [c, true])), ...input.evidence } as AnalysisConfiguration['evidence'],
        inputLimits: { singleQuestionTokens: 32_000, combinedQuestionTokens: 64_000, maxBodyBytes: 32 * 1024 * 1024, headroomTokens: 2_000, estimatorVersion: DEFAULT_TOKEN_ESTIMATOR_VERSION, ...input.inputLimits },
    };
    if (input.longContext !== undefined && input.longContext !== false) throw new Error('Long-context mode is not supported');
    if (config.version !== 1) throw new Error('Unsupported analysis configuration version');
    if (typeof config.model !== 'string' || !config.model.trim() || config.model.length > 200) throw new Error('A model identifier is required');
    integer(config.window.size, 'Window size', 10_000); integer(config.window.stride, 'Window stride', config.window.size);
    integer(config.concurrency, 'Concurrency', 16); integer(config.timeoutMs, 'Timeout', 900_000);
    integer(config.maxAttempts, 'Maximum attempts', 10); integer(config.retryBaseMs, 'Retry base delay', 60_000);
    const s = config.selection;
    if (!Array.isArray(s.phases) || !s.phases.length || new Set(s.phases).size !== s.phases.length || s.phases.some(p => p !== 'action' && p !== 'report')) throw new Error('Select action and/or report phases');
    if (s.startOrdinal !== undefined) integer(s.startOrdinal, 'Start ordinal', Number.MAX_SAFE_INTEGER);
    if (s.endOrdinal !== undefined) integer(s.endOrdinal, 'End ordinal', Number.MAX_SAFE_INTEGER);
    if ((s.startOrdinal ?? 1) > (s.endOrdinal ?? Number.MAX_SAFE_INTEGER)) throw new Error('Step range is reversed');
    for (const [k, v] of Object.entries(config.evidence)) if (!EVIDENCE_CATEGORIES.includes(k as typeof EVIDENCE_CATEGORIES[number]) || typeof v !== 'boolean') throw new Error(`Invalid evidence selection: ${k}`);
    for (const k of ['singleQuestionTokens', 'combinedQuestionTokens', 'maxBodyBytes'] as const) integer(config.inputLimits[k], k, k === 'maxBodyBytes' ? 32 * 1024 * 1024 : k === 'singleQuestionTokens' ? 32_000 : 64_000);
    if (!Number.isSafeInteger(config.inputLimits.headroomTokens) || config.inputLimits.headroomTokens < 0 || config.inputLimits.headroomTokens >= Math.min(config.inputLimits.singleQuestionTokens, config.inputLimits.combinedQuestionTokens)) throw new Error('Invalid token headroom');
    if (typeof config.inputLimits.estimatorVersion !== 'string' || !isTokenEstimatorVersion(config.inputLimits.estimatorVersion)) throw new Error('Unsupported token estimator');
    return immutableSnapshot(config);
}

/** Only the frozen task, policy and condition are classifier context; never scenario assets or answer keys. */
export function staticContextForRun(run: Run): { version: string; text: string; hash: string } {
    const text = stableStringify({ task: run.config.scenario.task, policy: run.config.scenario.policy, condition: run.config.condition.text });
    return { version: 'task-policy-v1', text, hash: snapshotHash(text) };
}

/** The codebook module owns definition validation and the seeds; re-exported so existing imports keep working. */
export { createSeedCodebook, validateBehaviorDefinitions } from './codebook.js';
