import assert from 'node:assert/strict';
import test from 'node:test';
import type { Decision } from '@sidechannel/contracts/analysis/jev-reviews';
import { cohenKappa, computeDisagreements, computeValidation, consensus, DEFAULT_VALIDATION_CONFIG, deriveStatus, optimalThreshold, type LabelledWindow, type ValidationInput } from './validation.js';

const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);

const win = (id: string, codeId: string, score: number | null, ...decisions: [string, Decision][]): LabelledWindow => ({ analysisId: 'a1', windowId: id, codeId, score, decisions: decisions.map(([reviewer, decision]) => ({ reviewer, decision })) });
const input = (windows: LabelledWindow[], codeIds: string[], noiseFloors: Record<string, number | null> = {}): ValidationInput => ({ definitionRevision: 'rev1', model: 'm', codeIds, windows, noiseFloors });

// Single-reviewer fixture, labels (P = present, A = absent) against scores, worked by hand:
//   P: .9 .8 .75 .6 .2    A: .8 .4 .3 .1 .05
const rows: [Decision, number][] = [['present', 0.9], ['present', 0.8], ['present', 0.75], ['present', 0.6], ['present', 0.2], ['absent', 0.8], ['absent', 0.4], ['absent', 0.3], ['absent', 0.1], ['absent', 0.05]];
const fixture = rows.map(([decision, score], i) => win(`w${i}`, 'c', score, ['alice', decision]));

test('precision, recall and F1 at the fixed 0.7 threshold match the hand calculation', () => {
    // flagged at >= .7: P .9 .8 .75 and A .8, so tp 3, fp 1, fn 2: precision 3/4, recall 3/5, F1 = 2(.75)(.6)/1.35
    const [c] = computeValidation(input(fixture, ['c']));
    near(c!.precision, 0.75); near(c!.recall, 0.6); near(c!.f1, 2 / 3);
    assert.deepEqual([c!.labels, c!.positives, c!.negatives, c!.uncertain, c!.reviewers], [10, 5, 5, 0, 1]);
    assert.equal(c!.fixed.threshold, 0.7);
});

test('the F1-optimal threshold is found among observed scores', () => {
    // t=.6: tp 4 fp 1 fn 1 gives F1 .8, the best of all candidates (t=.2 gives .769, t=.4 gives .727)
    const best = optimalThreshold(fixture.map((w, i) => ({ label: rows[i]![0] === 'present', score: w.score! })));
    assert.equal(best!.threshold, 0.6); near(best!.precision, 0.8); near(best!.recall, 0.8); near(best!.f1, 0.8);
    const [c] = computeValidation(input(fixture, ['c']));
    assert.equal(c!.optimalThreshold, 0.6); assert.equal(c!.optimal!.f1, best!.f1);
});

test('ties between thresholds resolve to the lowest and no positives gives no optimum', () => {
    const perfect = optimalThreshold([{ label: true, score: 0.8 }, { label: true, score: 0.9 }, { label: false, score: 0.1 }]);
    assert.equal(perfect!.threshold, 0.8); assert.equal(perfect!.f1, 1);
    assert.equal(optimalThreshold([{ label: false, score: 0.5 }]), null);
});

test('human-model kappa matches the hand calculation', () => {
    // thresholded at .7 the model flags 4 of 10 and the human 5 of 10; they agree on tp 3 + tn 4 = 7
    // po = .7, pe = (.5)(.4) + (.5)(.6) = .5, kappa = (.7 - .5) / (1 - .5) = .4
    const [c] = computeValidation(input(fixture, ['c']));
    near(c!.kappaHumanModel, 0.4);
});

test('kappa is null when chance agreement is certain or there is nothing to compare', () => {
    assert.equal(cohenKappa([]), null);
    assert.equal(cohenKappa([[true, true], [true, true]]), null);
    near(cohenKappa([[true, true], [false, false]]), 1);
    near(cohenKappa([[true, false], [false, true]]), -1);
});

test('human-human kappa uses windows with two reviewers and a tie is contested out of model metrics', () => {
    // alice: P P A A, bob: P A A A -> agree 3/4, alice positive rate .5, bob .25, pe = .5(.25) + .5(.75) = .5, kappa = .25 / .5 = .5
    const h = [win('h1', 'h', 0.9, ['alice', 'present'], ['bob', 'present']), win('h2', 'h', 0.8, ['alice', 'present'], ['bob', 'absent']),
        win('h3', 'h', 0.1, ['alice', 'absent'], ['bob', 'absent']), win('h4', 'h', 0.2, ['alice', 'absent'], ['bob', 'absent'])];
    const [c] = computeValidation(input(h, ['h']));
    near(c!.kappaHumanHuman, 0.5); assert.equal(c!.reviewers, 2);
    assert.equal(c!.contested, 1); assert.equal(c!.labels, 3, 'the split window is excluded from model metrics');
    assert.ok(c!.reasons.some(r => r.includes('1 contested')));
});

test('uncertain windows are counted and excluded; uncertain votes never count towards agreement', () => {
    const u = [win('u1', 'u', 0.9, ['alice', 'uncertain']), win('u2', 'u', 0.9, ['alice', 'present'], ['bob', 'uncertain']), win('u3', 'u', null, ['alice', 'absent'])];
    const [c] = computeValidation(input(u, ['u']));
    assert.equal(c!.uncertain, 1); assert.equal(c!.labels, 1, 'u2 counts as present, u3 has no score'); assert.equal(c!.kappaHumanHuman, null);
    assert.equal(consensus([{ decision: 'uncertain' }]), 'uncertain'); assert.equal(consensus([]), null);
    assert.equal(consensus([{ decision: 'present' }, { decision: 'absent' }, { decision: 'present' }]), 'present');
});

test('the noise floor comes from reliability and is null otherwise', () => {
    assert.equal(computeValidation(input(fixture, ['c'], { c: 0.04 }))[0]!.noiseFloor, 0.04);
    assert.equal(computeValidation(input(fixture, ['c']))[0]!.noiseFloor, null);
});

const base = { labels: 30, positives: 8, kappaHumanModel: 0.67 as number | null, noiseFloor: null as number | null, optimalThreshold: null as number | null, precision: 0.9 as number | null };
const status = (patch: Partial<typeof base>, config = DEFAULT_VALIDATION_CONFIG) => deriveStatus({ ...base, ...patch }, config).status;

test('unvalidated boundaries: 20 labels and 5 positives', () => {
    assert.equal(status({ labels: 19, kappaHumanModel: 0.9 }), 'unvalidated');
    assert.equal(status({ labels: 20, positives: 4, kappaHumanModel: 0.9 }), 'unvalidated');
    assert.equal(status({ labels: 20, positives: 5, kappaHumanModel: 0.9 }), 'tentative');
    assert.equal(status({ kappaHumanModel: null }), 'unvalidated');
});

test('kappa boundaries: below 0.4 unreliable, 0.4 up to 0.67 tentative, 0.67 validated', () => {
    assert.equal(status({ kappaHumanModel: 0.3999 }), 'unreliable');
    assert.equal(status({ kappaHumanModel: 0.4 }), 'tentative');
    assert.equal(status({ kappaHumanModel: 0.6699 }), 'tentative');
    assert.equal(status({ kappaHumanModel: 0.67 }), 'validated');
});

test('validated also needs 30 labels and 8 positives, otherwise it stays tentative', () => {
    assert.equal(status({ labels: 29, kappaHumanModel: 0.9 }), 'tentative');
    assert.equal(status({ positives: 7, kappaHumanModel: 0.9 }), 'tentative');
    assert.equal(status({ labels: 30, positives: 8, kappaHumanModel: 0.9 }), 'validated');
});

test('unreliable when the optimal threshold sits within one noise floor of 0.5, inclusive', () => {
    assert.equal(status({ kappaHumanModel: 0.9, optimalThreshold: 0.55, noiseFloor: 0.05 }), 'unreliable');
    assert.equal(status({ kappaHumanModel: 0.9, optimalThreshold: 0.45, noiseFloor: 0.05 }), 'unreliable');
    assert.equal(status({ kappaHumanModel: 0.9, optimalThreshold: 0.56, noiseFloor: 0.05 }), 'validated');
    assert.equal(status({ kappaHumanModel: 0.9, optimalThreshold: 0.5, noiseFloor: null }), 'validated', 'no reliability data, no rule');
});

test('unreliable when precision on flagged windows is below 0.6', () => {
    assert.equal(status({ kappaHumanModel: 0.9, precision: 0.5999 }), 'unreliable');
    assert.equal(status({ kappaHumanModel: 0.9, precision: 0.6 }), 'validated');
    assert.equal(status({ kappaHumanModel: 0.9, precision: null }), 'validated', 'nothing flagged, nothing to be imprecise about');
});

test('cut points come from configuration, not literals', () => {
    const strict = { ...DEFAULT_VALIDATION_CONFIG, validatedKappa: 0.8, minLabels: 40 };
    assert.equal(status({ kappaHumanModel: 0.7 }, strict), 'unvalidated');
    assert.equal(status({ labels: 40, kappaHumanModel: 0.7 }, strict), 'tentative');
    assert.equal(computeValidation(input(fixture, ['c']), { ...DEFAULT_VALIDATION_CONFIG, fixedThreshold: 0.5 })[0]!.fixed.threshold, 0.5);
});

test('reasons name every rule that fired', () => {
    const { status: s, reasons } = deriveStatus({ ...base, kappaHumanModel: 0.2, precision: 0.5, optimalThreshold: 0.5, noiseFloor: 0.1 }, DEFAULT_VALIDATION_CONFIG);
    assert.equal(s, 'unreliable'); assert.equal(reasons.length, 3);
});

test('disagreements are ordered by absolute gap and grouped by which side is wrong', () => {
    const d = [win('a', 'c', 0.95, ['alice', 'absent']), win('b', 'c', 0.7, ['alice', 'absent']), win('c', 'c', 0.05, ['alice', 'present']), win('d', 'c', 0.4, ['alice', 'present']),
        win('e', 'c', 0.9, ['alice', 'present']), win('f', 'c', 0.5, ['alice', 'uncertain']), win('g', 'c', null, ['alice', 'absent']), win('h', 'other', 0.99, ['alice', 'absent'])];
    const out = computeDisagreements({ windows: d }, 'c');
    assert.deepEqual(out.modelHighHumanAbsent.map(r => r.windowId), ['a', 'b']);
    assert.deepEqual(out.modelLowHumanPresent.map(r => r.windowId), ['c', 'd', 'e']);
    near(out.modelHighHumanAbsent[0]!.gap, 0.95); near(out.modelLowHumanPresent[0]!.gap, 0.95); near(out.modelLowHumanPresent[2]!.gap, 0.1);
    assert.equal(computeDisagreements({ windows: d }, 'c', 1).modelLowHumanPresent.length, 1);
});
