import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisConflict, AnalysisNotFound, AnalysisPayloadTooLarge, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';
import { DomainFailure } from '@sidechannel/contracts/errors';
import { RepositoryConflict } from '@sidechannel/contracts/harness/repository';
import { OversightError } from '@sidechannel/domain/oversight/service';
import { HttpError, statusOf } from './errors.js';

test('domain failure kinds map to the conventions §3.6 status codes', () => {
    assert.deepEqual(
        (['invalid', 'not-found', 'conflict', 'too-large', 'unavailable'] as const).map(kind => statusOf(new DomainFailure(kind, 'x'))),
        [400, 404, 409, 413, 503],
    );
});

test('legacy typed error classes keep their own status', () => {
    assert.equal(statusOf(new HttpError(401, 'x')), 401);
    assert.equal(statusOf(new AnalysisConflict('x')), 409);
    assert.equal(statusOf(new AnalysisNotFound('x')), 404);
    assert.equal(statusOf(new AnalysisValidation('x')), 400);
    assert.equal(statusOf(new AnalysisPayloadTooLarge('x')), 413);
    assert.equal(statusOf(new RepositoryConflict('x')), 409);
    assert.equal(statusOf(new OversightError(404, 'x')), 404);
});

test('untyped errors are 400 and message text is never inspected', () => {
    assert.equal(statusOf(new Error('conflict: stale and not found')), 400);
    assert.equal(statusOf('conflict'), 400);
    assert.equal(statusOf(undefined), 400);
});
