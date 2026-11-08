import type { Run } from '@sidechannel/contracts/harness/contracts';
import { ANALYSIS_PRESETS, EVIDENCE_CATEGORIES, type AnalysisConfiguration, type AnalysisConfigurationInput, type AnalysisPreset, type ProbeConfiguration, type WindowConfiguration } from '@sidechannel/contracts/analysis/evidence-contracts';
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

/** Probe defaults applied by every preset (spec section 6). Without a preset a probe runs only when asked for. */
export const DEFAULT_PROBE: ProbeConfiguration = { windows: 6, repeats: 4, seed: 'probe-v1' };

/** Whole-run window: larger than any run, so `buildWindows` emits a single partial window over every selected step. */
export const WHOLE_RUN_WINDOW_SIZE = 10_000;

/** Documented long-context ceiling: the `TypeSafe-Danger-Zone-Long-Context` header raises both question limits to this. */
export const LONG_CONTEXT_TOKENS = 262_000;

/** Window settings per preset (spec section 7). `custom` has no bundle: it is the v1 form with the v1 defaults. */
export const PRESET_WINDOWS: Record<AnalysisPreset, WindowConfiguration> = {
    dense: { size: 1, stride: 1 }, windowed: { size: 6, stride: 3 }, 'whole-run': { size: WHOLE_RUN_WINDOW_SIZE, stride: WHOLE_RUN_WINDOW_SIZE }, custom: { size: 12, stride: 4 },
};

/** Largest window size, up to 8, with no oversized window: the size the `windowed` preset suggests (spec section 7). */
export const WINDOWED_SUGGESTION_MAX = 8;

export function resolveAnalysisConfiguration(input: AnalysisConfigurationInput = {}): AnalysisConfiguration {
    allowedKeys(input, ['version', 'model', 'window', 'selection', 'evidence', 'inputLimits', 'concurrency', 'timeoutMs', 'maxAttempts', 'retryBaseMs', 'longContext', 'preset', 'probe'], 'analysis');
    if (input.probe !== undefined && input.probe !== null) allowedKeys(input.probe, ['windows', 'repeats', 'seed'], 'probe');
    if (input.preset !== undefined && !ANALYSIS_PRESETS.includes(input.preset)) throw new Error('Unknown analysis preset');
    const { probe: probeInput, preset, longContext: longContextInput, ...rest } = input;
    if (longContextInput !== undefined && typeof longContextInput !== 'boolean') throw new Error('longContext must be a boolean');
    if (input.window !== undefined) allowedKeys(input.window, ['size', 'stride'], 'window');
    const presetWindow = PRESET_WINDOWS[preset ?? 'custom'];
    const longContext = longContextInput ?? preset === 'whole-run';
    if (preset === 'whole-run' && !longContext) throw new Error('The whole-run preset requires longContext: true');
    // An explicit size without a stride keeps the preset's stride where that is still valid (stride cannot exceed size).
    const window: WindowConfiguration = { size: input.window?.size ?? presetWindow.size, stride: input.window?.stride ?? (input.window?.size !== undefined ? Math.min(presetWindow.stride, input.window.size) : presetWindow.stride) };
    const probe: ProbeConfiguration | undefined = probeInput === null ? undefined : probeInput ? { ...DEFAULT_PROBE, ...probeInput } : preset !== undefined && preset !== 'custom' ? { ...DEFAULT_PROBE } : undefined;
    const tokenCeiling = longContext ? LONG_CONTEXT_TOKENS : undefined;
    if (input.window !== undefined) allowedKeys(input.window, ['size', 'stride'], 'window');
    if (input.selection !== undefined) allowedKeys(input.selection, ['phases', 'startOrdinal', 'endOrdinal'], 'selection');
    if (input.evidence !== undefined) allowedKeys(input.evidence, EVIDENCE_CATEGORIES, 'evidence');
    if (input.inputLimits !== undefined) allowedKeys(input.inputLimits, ['singleQuestionTokens', 'combinedQuestionTokens', 'maxBodyBytes', 'headroomTokens', 'estimatorVersion'], 'input limit');
    const config: AnalysisConfiguration = {
        version: 1, model: 'jev-1.14.0', concurrency: 2, timeoutMs: 120_000, maxAttempts: 3, retryBaseMs: 1_000,
        ...rest, longContext,
        ...(preset !== undefined ? { preset } : {}),
        ...(probe ? { probe } : {}),
        window,
        selection: { phases: ['action', 'report'], ...input.selection },
        evidence: { ...Object.fromEntries(EVIDENCE_CATEGORIES.map(c => [c, true])), ...input.evidence } as AnalysisConfiguration['evidence'],
        inputLimits: { singleQuestionTokens: tokenCeiling ?? 32_000, combinedQuestionTokens: tokenCeiling ?? 64_000, maxBodyBytes: 32 * 1024 * 1024, headroomTokens: 2_000, estimatorVersion: DEFAULT_TOKEN_ESTIMATOR_VERSION, ...input.inputLimits },
    };
    if (config.probe) {
        integer(config.probe.windows, 'Probe windows', 50); integer(config.probe.repeats, 'Probe repeats', 10);
        if (typeof config.probe.seed !== 'string' || !config.probe.seed.trim() || config.probe.seed.length > 200) throw new Error('Probe seed must be a nonempty string');
    }
    if (config.version !== 1) throw new Error('Unsupported analysis configuration version');
    if (typeof config.model !== 'string' || !config.model.trim() || config.model.length > 200) throw new Error('A model identifier is required');
    integer(config.window.size, 'Window size', WHOLE_RUN_WINDOW_SIZE); integer(config.window.stride, 'Window stride', config.window.size);
    integer(config.concurrency, 'Concurrency', 16); integer(config.timeoutMs, 'Timeout', 900_000);
    integer(config.maxAttempts, 'Maximum attempts', 10); integer(config.retryBaseMs, 'Retry base delay', 60_000);
    const s = config.selection;
    if (!Array.isArray(s.phases) || !s.phases.length || new Set(s.phases).size !== s.phases.length || s.phases.some(p => p !== 'action' && p !== 'report')) throw new Error('Select action and/or report phases');
    if (s.startOrdinal !== undefined) integer(s.startOrdinal, 'Start ordinal', Number.MAX_SAFE_INTEGER);
    if (s.endOrdinal !== undefined) integer(s.endOrdinal, 'End ordinal', Number.MAX_SAFE_INTEGER);
    if ((s.startOrdinal ?? 1) > (s.endOrdinal ?? Number.MAX_SAFE_INTEGER)) throw new Error('Step range is reversed');
    for (const [k, v] of Object.entries(config.evidence)) if (!EVIDENCE_CATEGORIES.includes(k as typeof EVIDENCE_CATEGORIES[number]) || typeof v !== 'boolean') throw new Error(`Invalid evidence selection: ${k}`);
    for (const k of ['singleQuestionTokens', 'combinedQuestionTokens', 'maxBodyBytes'] as const) integer(config.inputLimits[k], k, k === 'maxBodyBytes' ? 32 * 1024 * 1024 : config.longContext ? LONG_CONTEXT_TOKENS : k === 'singleQuestionTokens' ? 32_000 : 64_000);
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
