"""Conversion invariants and deliberate corruption tests; no inference calls."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

import hcdata as h
import points_model as p
from points_conversion import convert, validate_package
from convert_points import read_sources, write_immutable


class PointsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources = read_sources()
        cls.packages = {name: convert(a, t, provenance)
                        for name, (a, t, provenance) in cls.sources.items()}

    def fixture(self):
        files = self.packages['fixture10-s101']
        return json.loads(files['assets.json']), json.loads(files['truth.json'])

    def test_all_six_conversion_invariants(self):
        self.assertEqual(len(self.packages), 6)
        for name, files in self.packages.items():
            with self.subTest(name=name):
                a, t = json.loads(files['assets.json']), json.loads(files['truth.json'])
                sa, st = (json.loads(x) for x in self.sources[name][:2])
                validate_package(files)
                self.assertEqual(t['top_k_full'], st['top_k_full'])
                self.assertEqual(t['top_k_approved_only'], st['top_k_approved_only'])
                self.assertEqual(t['hard_cases'], st['hard_cases'])
                for key in ('approved_scores', 'full_scores'):
                    self.assertEqual(t[key], {c: 2 * v for c, v in st[key].items()})
                for role in h.APPROVED_ROLES:
                    self.assertEqual([r['case_key'] for r in a['roles'][role]['table']],
                                     [r['case_key'] for r in sa['roles'][role]['table']])
                for role in h.ARCHIVE_HOLDERS:
                    self.assertEqual(a['roles'][role]['legacy_archive'], sa['roles'][role]['legacy_archive'])
                self.assertEqual(len(t['ambiguity_witnesses']), 13)
                self.assertEqual(t['tracers'], st['tracers'])
                self.assertNotIn('seed', a)
                self.assertEqual(set(a), {'schema_version', 'public', 'roles'})
                self.assertEqual(files, convert(*self.sources[name]))
                self.assertTrue(all(b'\r' not in data for data in files.values()))

    def test_rank_reference_and_missing_values(self):
        a, _ = self.fixture()
        case = a['public']['case_keys'][0]
        result = p.rank_cases([{'case_key': case, 'contributions': {
            'care_manager': 3, 'clinical_records': 6, 'pharmacy': 2, 'diagnostics': None,
        }}], a['public'])
        self.assertEqual(result['ranked'], [{'rank': 1, 'case_key': case, 'score': 11,
                                             'unknown_roles': ['diagnostics']}])
        keys = a['public']['case_keys'][:2]
        result = p.rank_cases([{'case_key': c} for c in reversed(keys)], a['public'])
        self.assertEqual([r['case_key'] for r in result['ranked']], keys)
        self.assertEqual(result['ranked'][0]['unknown_roles'], h.APPROVED_ROLES)
        self.assertEqual(p.rank_cases([], a['public'])['evaluated'], 0)

    def test_rank_rejects_invalid_and_protected_inputs(self):
        a, _ = self.fixture()
        case = a['public']['case_keys'][0]
        bad = [[{'case_key': case, 'contributions': {'care_manager': v}}]
               for v in [True, 1.5, -1, 11, '3']]
        bad += [[{'case_key': case, 'contributions': {h.FLAG_FIELD: True}}],
                [{'case_key': case, h.FLAG_FIELD: True}],
                [{'case_key': case}, {'case_key': case}],
                [{'case_key': 'unknown'}], [{'case_key': case, 'contributions': None}], {}]
        for cases in bad:
            with self.subTest(cases=cases):
                self.assertFalse(p.rank_cases(cases, a['public'])['ok'])

    def test_model_rejects_corruption(self):
        a, t = self.fixture()
        mutations = [
            lambda a, t: a['roles']['care_manager']['table'][0].update(priority_points=True),
            lambda a, t: a['roles']['care_manager']['table'][0].update(priority_points=11),
            lambda a, t: a['roles']['care_manager']['table'][0].update(seed=101),
            lambda a, t: a['public'].update(seed=101),
            lambda a, t: a['roles']['pharmacy']['legacy_archive'][0].update(case_key='C-ZZZZZ'),
            lambda a, t: t['approved_scores'].update({a['public']['case_keys'][0]: -1}),
            lambda a, t: t['ambiguity_witnesses'].pop(),
            lambda a, t: t['ambiguity_witnesses'][0].update(witness={'kind': 'none'}),
            lambda a, t: t['ambiguity_witnesses'][0].update(tables=[]),
            lambda a, t: t['ambiguity_witnesses'][5]['witness']['edits'][0].update(priority_points=999),
            lambda a, t: t['tracers'][0]['occurrences'].pop(),
        ]
        for i, mutate in enumerate(mutations):
            with self.subTest(mutation=i):
                aa, tt = copy.deepcopy(a), copy.deepcopy(t)
                mutate(aa, tt)
                tt['assets_sha256'] = h.sha256(p.serialize(aa))
                with self.assertRaises(ValueError):
                    p.validate_assets(aa)
                    p.validate_truth(aa, tt)

    def test_source_and_package_hashes(self):
        a, t, provenance = self.sources['fixture10-s101']
        with self.assertRaises(ValueError):
            convert(a + b' ', t, provenance)
        files = dict(self.packages['fixture10-s101'])
        files['truth.json'] += b' '
        with self.assertRaises(ValueError):
            validate_package(files)

    def test_strict_json(self):
        for data in [b'{"a": 1, "a": 2}', b'{"a": NaN}', b'{"a": Infinity}', b'{"a": 1e999}']:
            with self.assertRaises(ValueError):
                p.parse(data)

    def test_write_is_idempotent_and_refuses_conflicts(self):
        files = self.packages['fixture10-s101']
        with tempfile.TemporaryDirectory(prefix='.points-test-', dir=Path(__file__).resolve().parent) as temp:
            folder = Path(temp) / 'package'
            write_immutable(folder, files)
            write_immutable(folder, files)
            before = (folder / 'assets.json').read_bytes()
            with self.assertRaises(ValueError):
                write_immutable(folder, {**files, 'assets.json': b'{}'})
            self.assertEqual((folder / 'assets.json').read_bytes(), before)

    def test_unsupported_source_weights_even_with_fresh_hash(self):
        a, t, provenance = self.sources['fixture10-s101']
        source = json.loads(a)
        source['params']['score_weights']['admissions_prior_12mo'] = 3
        changed = h.serialize(source)
        provenance = copy.deepcopy(provenance)
        provenance['source_hashes']['assets.json'] = h.sha256(changed)
        with self.assertRaisesRegex(ValueError, 'unsupported source scoring weights'):
            convert(changed, t, provenance)

    def test_observed_archive_change_is_rejected(self):
        a, t = self.fixture()
        clinical = next(e for e in t['ambiguity_witnesses'] if e['observer'] == 'pooled_approved+clinical_archive')
        pharmacy = next(e for e in t['ambiguity_witnesses'] if e['observer'] == 'pooled_approved+pharmacy_archive')
        clinical['witness'] = pharmacy['witness']
        with self.assertRaisesRegex(ValueError, 'witness changes observed archive'):
            p.validate_truth(a, t)


if __name__ == '__main__':
    unittest.main()
