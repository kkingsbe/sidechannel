import { DEFAULT_TOKEN_ESTIMATOR_VERSION, TOKEN_ESTIMATOR_VERSIONS, type TokenEstimatorVersion } from '@sidechannel/contracts/analysis/serialization';

export { DEFAULT_TOKEN_ESTIMATOR_VERSION, TOKEN_ESTIMATOR_VERSIONS, type TokenEstimatorVersion };

/**
 * Tokens per UTF-8 byte for `utf8-bytes-calibrated-v1`.
 *
 * Fitted on November 8, 2026 against provider-reported `input_tokens` for 66 scored windows of
 * two production analyses (window sizes 1 and 4, states of 4 KiB to 27 KiB): reported tokens grew
 * by about 0.46 per byte of window state, plus a near-constant share for the questions. 0.6 keeps
 * roughly 30% margin over that fit. It is still an estimate, never a tokenizer or a billing count.
 */
export const CALIBRATED_TOKENS_PER_BYTE = 0.6;

export function isTokenEstimatorVersion(value: string): value is TokenEstimatorVersion {
    return (TOKEN_ESTIMATOR_VERSIONS as readonly string[]).includes(value);
}

export function assertTokenEstimatorVersion(value: string): TokenEstimatorVersion {
    if (!isTokenEstimatorVersion(value)) throw new Error(`Unsupported token estimator: ${value}`);
    return value;
}

/** Local estimate for the named estimator version, NOT a tokenizer or provider billing count. */
export function estimateTokens(text: string, version: string = DEFAULT_TOKEN_ESTIMATOR_VERSION): number {
    const bytes = Buffer.byteLength(text, 'utf8');
    switch (assertTokenEstimatorVersion(version)) {
        case 'utf8-bytes-conservative-v1': return bytes;
        case 'utf8-bytes-calibrated-v1': return Math.ceil(bytes * CALIBRATED_TOKENS_PER_BYTE);
    }
}
