import type { BackgroundPart, InputLimits } from './evidence-contracts.js';
import type { JsonValue } from './jev-provider.js';

/**
 * Frozen token estimator versions. `conservative` counts one token per UTF-8 byte; `calibrated`
 * scales bytes by a ratio fitted to provider-reported usage. A manifest records the version it
 * was prepared with, and every version listed here stays readable for existing analyses.
 */
export const TOKEN_ESTIMATOR_VERSIONS = ['utf8-bytes-conservative-v1', 'utf8-bytes-calibrated-v1'] as const;
export type TokenEstimatorVersion = typeof TOKEN_ESTIMATOR_VERSIONS[number];
export const DEFAULT_TOKEN_ESTIMATOR_VERSION: TokenEstimatorVersion = 'utf8-bytes-calibrated-v1';

/** The parts of a question that count toward the input budget. Instructions may be text or a JSON object of named fields. */
/** `codeId` is the question key (`code` or `code@actor`). `background` is the grouping set for request batching (spec 5.3). */
export interface BudgetQuestion { codeId: string; instructions: JsonValue; criteria?: { true: string; false: string } | Record<string, string | null> | string[]; background?: readonly BackgroundPart[]; }

/** `codeIds` are question keys. `background` and `backgroundKey` name the background group the batch carries (empty for none). */
export interface QuestionBatch { codeIds: string[]; bytes: number; estimatedTokens: number; background?: BackgroundPart[]; backgroundKey?: string; }

export interface WindowPreflight { oversized: boolean; reason?: string; batches: QuestionBatch[]; bytes: number; estimatedTokens: number; estimatorVersion: string; effectiveLimits: InputLimits; }