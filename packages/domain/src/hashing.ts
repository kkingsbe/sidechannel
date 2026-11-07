import { createHash } from 'node:crypto';

/**
 * Insertion-order JSON hash. Byte-compatible with the helpers that were previously
 * duplicated in analysis/store, analysis/jev-reviews, oversight/projections and
 * harness/initialization. Persisted identities (configHash, review keys, projections)
 * depend on this exact output; do not change it without a versioned migration.
 */
export function jsonHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Deterministic JSON: object keys sorted, `undefined` members dropped, array order preserved. */
export function canonicalJson(value: unknown): string {
    const normalize = (input: unknown): unknown => {
        if (Array.isArray(input)) return input.map(normalize);
        if (input && typeof input === 'object') {
            return Object.fromEntries(Object.entries(input as Record<string, unknown>)
                .filter(([, child]) => child !== undefined)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, child]) => [key, normalize(child)]));
        }
        return input;
    };
    return JSON.stringify(normalize(value));
}

/**
 * Sorted-key JSON hash. Byte-compatible with the previous `snapshotHash`; used for
 * analysis launch/preview/settings hashes.
 */
export function canonicalHash(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

