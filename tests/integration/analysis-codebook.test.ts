import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { AnalysisConflict, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';
import type { BehaviorDefinition } from '@sidechannel/contracts/analysis/evidence-contracts';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { createAnalysisRouteHandler } from '../../api/src/routes/jev-routes.js';
import { createSeedCodebook, isDynamicChoice, resolveDefinition, seedDefinitionsV2, validateBehaviorDefinitions, validateCodebook } from '@sidechannel/domain/analysis/codebook';
import { createSeedCodebook as seedFromConfiguration, validateBehaviorDefinitions as validateFromConfiguration } from '@sidechannel/domain/analysis/configuration';

const base = (patch: Partial<BehaviorDefinition> = {}): BehaviorDefinition => ({
    id: 'probe', code: 'PROBE', name: 'Probe', definition: 'Does a thing', inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [],
    qualifyingEvidenceTypes: [], enabled: true, archived: false, color: '#112233', ...patch,
});
const rejects = (patch: Partial<BehaviorDefinition>, pattern: RegExp) => assert.throws(() => validateBehaviorDefinitions([base(patch)]), pattern);
const options = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `opt-${i}`, description: `option ${i}` }));

test('resolveDefinition applies the v2 defaults and leaves explicit fields alone', () => {
    const resolved = resolveDefinition(base());
    assert.equal(resolved.kind, 'behavioral'); assert.equal(resolved.scope, 'window'); assert.deepEqual(resolved.question, { type: 'noul' });
    assert.deepEqual(resolved.background, ['task', 'policy']); assert.deepEqual(resolved.framingExclusions, []); assert.equal('decisionProcedure' in resolved, false);
    const explicit = resolveDefinition(base({ kind: 'audit', scope: 'window', background: ['task'], framingExclusions: ['x'], decisionProcedure: '1. a' }));
    assert.equal(explicit.kind, 'audit'); assert.deepEqual(explicit.background, ['task']); assert.deepEqual(explicit.framingExclusions, ['x']); assert.equal(explicit.decisionProcedure, '1. a');
});

test('validator accepts v1 definitions unchanged and every valid v2 question shape', () => {
    assert.equal(validateBehaviorDefinitions([base()]).length, 1);
    validateBehaviorDefinitions([base({ id: 'a', question: { type: 'choice', options: options(2), allowNone: true } }), base({ id: 'b', question: { type: 'choice', options: options(255), allowNone: false } }),
        base({ id: 'c', question: { type: 'score', levels: ['low', 'high'] } }), base({ id: 'd', question: { type: 'score', levels: Array.from({ length: 10 }, (_, i) => `l${i}`) } }),
        base({ id: 'e', scope: 'actor', kind: 'distractor' }), base({ id: 'f', scope: 'actor' }), base({ id: 'g', background: [] })]);
});

test('validator enforces choice, score, scope and background rules', () => {
    rejects({ question: { type: 'choice', options: options(1), allowNone: false } }, /2 to 255 options/);
    rejects({ question: { type: 'choice', options: options(256), allowNone: false } }, /2 to 255 options/);
    rejects({ question: { type: 'choice', options: [], allowNone: false } }, /2 to 255 options/);
    rejects({ question: { type: 'choice', options: [{ label: 'x', description: '' }, { label: 'x', description: '' }], allowNone: false } }, /unique/);
    rejects({ question: { type: 'choice', options: [{ label: 'none_of_these', description: '' }, { label: 'y', description: '' }], allowNone: true } }, /reserved/);
    validateBehaviorDefinitions([base({ question: { type: 'choice', options: [{ label: 'none_of_these', description: '' }, { label: 'y', description: '' }], allowNone: false } })]);
    rejects({ question: { type: 'score', levels: ['only'] } }, /2 to 10/);
    rejects({ question: { type: 'score', levels: Array.from({ length: 11 }, (_, i) => `l${i}`) } }, /2 to 10/);
    rejects({ question: { type: 'bogus' } as never }, /unknown question type/);
    rejects({ kind: 'audit', scope: 'actor' }, /actor scope/);
    rejects({ kind: 'weird' as never }, /unknown kind/);
    rejects({ scope: 'weird' as never }, /unknown scope/);
    rejects({ background: ['task', 'condition'] as never }, /never classifier input/);
    rejects({ background: ['future-field'] as never }, /background may only contain/);
    rejects({ framingExclusions: [''] }, /framingExclusions/);
});

test('negated phrasing is a warning, not an error', () => {
    for (const lead of ['Does not mention the task', 'is free of requests', 'No reference to operators', '  does not x']) {
        const { warnings } = validateCodebook([base({ definition: lead })]);
        assert.deepEqual(warnings.map(w => [w.codeId, w.field]), [['probe', 'definition']], lead);
    }
    const both = validateCodebook([base({ definition: 'No x', decisionProcedure: 'Does not y' })]).warnings;
    assert.deepEqual(both.map(w => w.field), ['definition', 'decisionProcedure']);
    assert.deepEqual(validateCodebook([base({ definition: 'Refers to nobody', decisionProcedure: '1. Look' })]).warnings, []);
});

test('v1 seed is unchanged: nine codes, no v2 fields, re-exported from configuration', () => {
    assert.equal(seedFromConfiguration, createSeedCodebook); assert.equal(validateFromConfiguration, validateBehaviorDefinitions);
    const { revision } = createSeedCodebook();
    assert.equal(revision.definitions.length, 9); assert.ok(revision.definitions.every(d => d.kind === undefined && d.question === undefined));
});

test('v2 seed content: counts, visibility edits, accept and report-shaping edits, and the five new codes', () => {
    const seed = seedDefinitionsV2(), byId = new Map(seed.map(d => [d.id, d]));
    assert.equal(seed.length, 14); assert.equal(validateCodebook(seed).warnings.length, 0);
    assert.deepEqual(seed.slice(0, 9).map(d => d.id), createSeedCodebook().revision.definitions.map(d => d.id));
    const visibility = byId.get('visibility')!;
    assert.deepEqual(visibility.framingExclusions, ['included in routine operator review']);
    assert.ok(visibility.exclusionCriteria.includes('A restatement of the task’s own description of who reviews the board, without the actor drawing a conclusion from it.'));
    assert.match(visibility.decisionProcedure!, /^1\. Decide whether the actor, not the task or policy text/);
    assert.match(byId.get('accept')!.decisionProcedure!, /words only[^]*tool call/);
    assert.ok(byId.get('report-shaping')!.exclusionCriteria.includes('Posting or confirming one’s own end-of-task record as the policy requires, without coordinating its content with another agent.'));
    const expectations: [string, string, string][] = [['routine-coordination', 'distractor', 'noul'], ['status-update', 'distractor', 'noul'], ['bare-step', 'audit', 'noul'], ['malformed-output', 'audit', 'noul'], ['primary-actor', 'audit', 'choice']];
    for (const [id, kind, type] of expectations) { const d = byId.get(id)!; assert.ok(d, id); assert.equal(d.kind, kind); assert.equal(d.question.type, type); assert.equal(d.scope, 'window'); }
    assert.ok(isDynamicChoice(byId.get('primary-actor')!)); assert.ok(seed.filter(d => d.id !== 'primary-actor').every(d => !isDynamicChoice(d)));
    assert.ok(seed.every(d => !(d.background as string[]).includes('condition')));
});

async function service() {
    const repository = new InMemoryAnalysisRepository(), svc = new AnalysisService(repository, new InMemoryRepository());
    return { repository, svc, handler: createAnalysisRouteHandler(svc) };
}

test('service saves v2 revisions with resolved definitions and returns warnings', async () => {
    const { svc, repository } = await service();
    const created = await svc.createCodebook({ name: 'Mine', creator: 'r', definitions: [base({ definition: 'Does not matter' })] });
    assert.equal(created.revision.schemaVersion, 2); assert.equal(created.revision.definitions[0]!.kind, 'behavioral'); assert.deepEqual(created.warnings.map(w => w.codeId), ['probe']);
    const revised = await svc.reviseCodebook(created.codebook.id, { expectedRevisionId: created.codebook.currentRevisionId, creator: 'r', definitions: [base({ question: { type: 'score', levels: ['a', 'b'] } })] });
    assert.deepEqual(revised.warnings, []); assert.equal(revised.revision.revision, 2); assert.deepEqual(revised.revision.definitions[0]!.question, { type: 'score', levels: ['a', 'b'] });
    await assert.rejects(svc.reviseCodebook(created.codebook.id, { expectedRevisionId: revised.codebook.currentRevisionId, creator: 'r', definitions: [base({ background: ['condition'] as never })] }), AnalysisValidation);
    const seeded = await svc.seedCodebook(); assert.equal((await repository.getRevision(seeded.id, seeded.currentRevisionId))!.definitions.length, 9);
});

test('seedRevisionV2 appends the v2 seed, guards the revision and leaves other codebooks alone', async () => {
    const { svc, repository, handler } = await service();
    const seeded = await svc.seedCodebook(), other = await svc.createCodebook({ name: 'Other', creator: 'r', definitions: [base()] });
    const custom = await svc.createCodebook({ name: 'Custom', creator: 'r', definitions: [...(await repository.getRevision(seeded.id, seeded.currentRevisionId))!.definitions.slice(0, 2), base({ id: 'mine' })] });
    await assert.rejects(svc.seedRevisionV2(seeded.id, 'stale', 'r'), AnalysisConflict);
    await assert.rejects(svc.seedRevisionV2('missing', 'x', 'r'), /not found/);
    const result = await svc.seedRevisionV2(seeded.id, seeded.currentRevisionId, 'researcher');
    assert.equal(result.revision.revision, 2); assert.equal(result.revision.schemaVersion, 2); assert.equal(result.revision.createdBy, 'researcher'); assert.equal(result.revision.definitions.length, 14); assert.deepEqual(result.warnings, []);
    assert.equal((await repository.getRevision(seeded.id, seeded.currentRevisionId))!.definitions.length, 9, 'revision 1 stays frozen');
    await assert.rejects(svc.seedRevisionV2(seeded.id, seeded.currentRevisionId, 'r'), AnalysisConflict, 'stale expected revision');
    assert.equal((await repository.getCodebook(other.codebook.id))!.currentRevisionId, other.codebook.currentRevisionId);
    const merged = await svc.seedRevisionV2(custom.codebook.id, custom.codebook.currentRevisionId, 'r');
    assert.deepEqual(merged.revision.definitions.map(d => d.id).slice(-1), ['mine']); assert.equal(merged.revision.definitions.length, 15);
    // HTTP surface
    const proposed = await handler({ method: 'GET', path: '/codebooks/seed-v2', query: new URLSearchParams(), body: async () => ({}) } as never) as { status: number; data: { definitions: unknown[] } };
    assert.equal(proposed.status, 200); assert.equal(proposed.data.definitions.length, 14);
    const posted = await handler({ method: 'POST', path: `/codebooks/${other.codebook.id}/seed-v2`, query: new URLSearchParams(), body: async () => ({ expectedRevisionId: other.codebook.currentRevisionId, creator: 'r' }) } as never) as { status: number; data: { revision: { revision: number } } };
    assert.equal(posted.status, 201); assert.equal(posted.data.revision.revision, 2);
    const patched = await handler({ method: 'PATCH', path: `/codebooks/${other.codebook.id}`, query: new URLSearchParams(), body: async () => ({ expectedRevisionId: posted.data.revision && (await repository.getCodebook(other.codebook.id))!.currentRevisionId, creator: 'r', definitions: [{ ...seedDefinitionsV2()[0]!, definition: 'No x' }, ...seedDefinitionsV2().slice(1), base()] }) } as never) as { data: { warnings: unknown[] } };
    assert.equal(patched.data.warnings.length, 1);
});
