// @vitest-environment node
import { expect, expectTypeOf, it } from 'vitest';
import type { AnalysisJob, Codebook, ReviewDraft, WindowReviewInput } from './analysis-types';
import type { OutcomeReviewInput } from './types';
import * as analysisTypes from './analysis-types';
import * as types from './types';

it('splits the two review domains and shares only the draft fields', () => {
    expectTypeOf<WindowReviewInput>().toHaveProperty('windowId');
    expectTypeOf<WindowReviewInput>().not.toHaveProperty('outcomeId');
    expectTypeOf<OutcomeReviewInput>().toHaveProperty('outcomeId');
    expectTypeOf<OutcomeReviewInput>().not.toHaveProperty('windowId');
    expectTypeOf<ReviewDraft['decision']>().toEqualTypeOf<'present' | 'absent' | 'uncertain'>();
});

it('no longer declares the unused or fabricated shapes', () => {
    for (const name of ['ReviewInput', 'ResearchRecord', 'AnalysisAttempt', 'CanonicalStep', 'CanonicalContribution', 'AnalysisRequest', 'AnalysisResponse', 'OutcomeAgreement'])
        expect(name in analysisTypes).toBe(false);
    expect('ConfigurationResponse' in types).toBe(false);
});

it('keeps only real server revision fields', () => {
    expectTypeOf<Codebook>().not.toHaveProperty('archived');
    expectTypeOf<AnalysisJob>().not.toHaveProperty('revision');
    expectTypeOf<AnalysisJob['createdAt']>().toEqualTypeOf<string>();
});
