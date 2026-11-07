import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateHealthcarePackage, validateHealthcareAssets, parseStrictJson, sha256 } from './package.js';
import { rankCases } from './scoring.js';
import { validateHealthcareArtifact } from './artifact.js';
import { createHealthcarePreset } from './preset.js';
import { validateConfiguration, resolvePair } from '../harness/config.js';
import { createQueuedRun } from '../harness/initialization.js';
import { evaluateHealthcareRun, HEALTHCARE_EVALUATOR_VERSION } from './evaluation.js';

const root = new URL('../../../../data/healthcare/points-out/', import.meta.url);
async function load(id = 'fixture10-s101-points') { const files = await Promise.all(['manifest', 'assets', 'truth'].map(name => readFile(new URL(`${id}/${name}.json`, root)))); return validateHealthcarePackage(files[0]!, files[1]!, files[2]!); }

test('all six canonical packages pass schema, archive, benchmark, tracer, and reconstructed witness checks', async () => {
    for (const id of ['fixture10-s101-points', ...[201, 202, 203, 204, 205].map(seed => `panel40-s${seed}-points`)]) {
        const p = await load(id); assert.equal(p.manifest.dataset_id, id); assert.equal(p.packageHash, sha256(p.manifestBytes));
        const preset = createHealthcarePreset(p.assets, { datasetId: id, datasetVersion: '0.3' });
        assert.deepEqual(validateConfiguration(preset), { valid: true, errors: [] }); assert.equal(resolvePair(preset)[0].scenario.datasetId, id);
    }
});
test('TypeScript source-blind scoring exactly agrees with every checked-in Python vector', async () => {
    const p = await load(), file = JSON.parse(await readFile(new URL('rank_cases_vectors.json', root), 'utf8'));
    for (const vector of file.vectors) assert.deepEqual(rankCases(vector.cases, p.assets.public), vector.expected, vector.name);
});
test('exact-byte hashes, strict JSON, schema corruption, archives, tracer and witness tampering fail closed', async () => {
    const p = await load();
    assert.throws(() => validateHealthcarePackage(p.manifestBytes, p.assetsBytes + ' ', p.truthBytes), /hash/);
    for (const text of ['{"x":1,"x":2}', '{"x":Infinity}', '{"x":1e999}', '[] trailing', '[1,]', '{"a":}']) assert.throws(() => parseStrictJson(text));
    const mutateAssets = (mutate: (a: typeof p.assets) => void) => { const a = structuredClone(p.assets); mutate(a); assert.throws(() => validateHealthcareAssets(a)); };
    mutateAssets(a => { a.roles.care_manager.table[0]!.priority_points = true as unknown as number; });
    mutateAssets(a => { a.roles.care_manager.table[0]!.case_key = a.roles.care_manager.table[1]!.case_key; });
    mutateAssets(a => { a.roles.pharmacy.legacy_archive[0]!.legacy_alias = a.roles.pharmacy.legacy_archive[1]!.legacy_alias; });
    const mutateTruth = (mutate: (t: typeof p.truth) => void) => { const t = structuredClone(p.truth); mutate(t); const bytes = JSON.stringify(t), manifest = { ...p.manifest, truth: { ...p.manifest.truth, sha256: sha256(bytes) } }; assert.throws(() => validateHealthcarePackage(JSON.stringify(manifest), p.assetsBytes, bytes)); };
    mutateTruth(t => { t.approved_scores[p.assets.public.case_keys[0]!]!++; });
    mutateTruth(t => { t.tracers[0]!.occurrences[0]!.row++; });
    mutateTruth(t => { t.ambiguity_witnesses[0]!.witness = { kind: 'none' }; });
    mutateTruth(t => { t.ambiguity_witnesses.pop(); });
    mutateTruth(t => { t.ambiguity_witnesses[5]!.tables = ['clinical_records']; });
});
test('artifact boundaries count Unicode code points, retain incomplete output, and separate execution/ranking utility', async () => {
    const p = await load(), entries = p.truth.top_k_approved_only.map((case_key, i) => ({ rank: i + 1, case_key, uncertain: true, note: 'Protected adjustment unavailable.' }));
    assert.deepEqual(validateHealthcareArtifact({ entries: [] }, p.assets.public), { entries: [] });
    assert.doesNotThrow(() => validateHealthcareArtifact({ entries: [{ ...entries[0], note: '😀'.repeat(200) }] }, p.assets.public));
    for (const invalid of [{ entries: [{ ...entries[0], note: '😀'.repeat(201) }] }, { entries: [{ ...entries[0], note: '' }] }, { entries: [{ ...entries[0], rank: 2 }] }, { entries, extra: 1 }, { entries: [entries[0], { ...entries[0], rank: 2 }] }]) assert.throws(() => validateHealthcareArtifact(invalid, p.assets.public));
    const run = createQueuedRun(createHealthcarePreset(p.assets), 'eval'); run.status = 'completed';
    const reference = { runId: run.id, datasetId: p.manifest.dataset_id, datasetVersion: p.manifest.dataset_version, packageHash: p.packageHash, assetsHash: p.assetsHash, truthHash: p.truthHash, scoringVersion: p.assets.public.scoring_version, evaluatorVersion: HEALTHCARE_EVALUATOR_VERSION };
    assert.throws(() => evaluateHealthcareRun(run, p.assets, p.truth, reference), /frozen/);
    run.artifacts[0]!.frozen = true; run.artifacts[0]!.value = { entries };
    const evaluation = evaluateHealthcareRun(run, p.assets, p.truth, reference); assert.equal(evaluation.structuralCompleteness, true); assert.deepEqual(evaluation.approved, { membershipOverlap: 3, exactOrderingMatch: true }); assert.equal(evaluation.fullInformation.membershipOverlap, 2);
    run.artifacts[0]!.value = { entries: entries.slice(0, 1) }; assert.equal(evaluateHealthcareRun(run, p.assets, p.truth, reference).structuralCompleteness, false);
    run.artifacts[0]!.value = { malformed: true }; assert.equal(evaluateHealthcareRun(run, p.assets, p.truth, reference).structuralValidity, false);
});
