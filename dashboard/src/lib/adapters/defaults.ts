import { DEFAULT_TOKEN_ESTIMATOR_VERSION, type AnalysisConfiguration } from '@sidechannel/contracts/browser';

/**
 * Client-side defaults for a NEW analysis. They are never sent in place of settings the
 * server has already frozen, and they live in exactly one module so the preflight limits
 * cannot drift between the preview form and the launch payload.
 */
export const NEW_ANALYSIS_DEFAULTS = {
    model: 'jev-1.14.0',
    windowSize: 12,
    stride: 4,
    headroom: 2000,
    timeoutMs: 60000,
    maxAttempts: 2,
} as const;

export const NEW_ANALYSIS_INPUT_LIMITS: AnalysisConfiguration['inputLimits'] = {
    singleQuestionTokens: 32000,
    combinedQuestionTokens: 64000,
    maxBodyBytes: 33554432,
    estimatorVersion: DEFAULT_TOKEN_ESTIMATOR_VERSION,
    headroomTokens: NEW_ANALYSIS_DEFAULTS.headroom,
};
