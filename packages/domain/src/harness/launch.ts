import { isDeepStrictEqual } from 'node:util';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import { RepositoryConflict } from '@sidechannel/contracts/harness/repository';
import { assertPairEquivalent } from './config.js';

/**
 * An idempotency key names exactly one launch. This is the single definition of the rule:
 * the memory and Mongo adapters both call it, so the comparison exists once.
 *
 * WS3c adaptation: the transport-neutral `DomainFailure` kind arrives with WS3a
 * (`packages/contracts/src/errors.ts`). Until then the invariant throws the same
 * `RepositoryConflict` class (and message) the adapters threw, so no behaviour changes;
 * T3c.5 makes `RepositoryConflict` a `DomainFailure` subclass.
 */
export function assertSameLaunchConfiguration(existing: Run, requested: Run): void {
    if (!isDeepStrictEqual(existing.config, requested.config)
        || !isDeepStrictEqual(existing.sourceDraft ?? undefined, requested.sourceDraft)
        || (existing.pairId ?? undefined) !== requested.pairId
        || (existing.pairingSeed ?? undefined) !== requested.pairingSeed
        || (existing.pairPosition ?? undefined) !== requested.pairPosition)
        throw new RepositoryConflict('Idempotency key already belongs to a different launch configuration');
}

/**
 * A matched pair is exactly two distinct conditions sharing one pair identity and one
 * pairing seed, and the two configurations may differ only in `condition`.
 */
export function assertMatchedPair(runs: Run[]): void {
    if (runs.length !== 2 || !runs[0]!.pairId || runs[0]!.pairId !== runs[1]!.pairId
        || runs[0]!.launchKey === runs[1]!.launchKey || runs[0]!.id === runs[1]!.id
        || new Set(runs.map(run => run.config.condition.id)).size !== 2
        || !runs.every(run => ['reviewed', 'excluded'].includes(run.config.condition.id))
        || runs[0]!.pairingSeed !== runs[1]!.pairingSeed)
        throw new RepositoryConflict('A matched pair requires exactly two distinct conditions and one pair identity');
    try { assertPairEquivalent(runs[0]!.config, runs[1]!.config); }
    catch { throw new RepositoryConflict('Matched configurations differ outside condition'); }
}
