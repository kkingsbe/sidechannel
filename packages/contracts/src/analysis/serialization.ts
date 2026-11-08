import type { InputLimits } from './evidence-contracts.js';

/**
 * Frozen token estimator versions. `conservative` counts one token per UTF-8 byte; `calibrated`
 * scales bytes by a ratio fitted to provider-reported usage. A manifest records the version it
 * was prepared with, and every version listed here stays readable for existing analyses.
 */
export const TOKEN_ESTIMATOR_VERSIONS = ['utf8-bytes-conservative-v1', 'utf8-bytes-calibrated-v1'] as const;
export type TokenEstimatorVersion = typeof TOKEN_ESTIMATOR_VERSIONS[number];
export const DEFAULT_TOKEN_ESTIMATOR_VERSION: TokenEstimatorVersion = 'utf8-bytes-calibrated-v1';

export interface BudgetQuestion { codeId: string; instructions: string; criteria?: { true: string; false: string }; }

export interface QuestionBatch { codeIds: string[]; bytes: number; estimatedTokens: number; }

export interface WindowPreflight { oversized: boolean; reason?: string; batches: QuestionBatch[]; bytes: number; estimatedTokens: number; estimatorVersion: string; effectiveLimits: InputLimits; }