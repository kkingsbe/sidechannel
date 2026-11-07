"""One deterministic adapter from validated v0.2 healthcare data to points packages."""
import copy
import re

import checks
import generate
import hcdata as h
import points_model as p

ADAPTER = 'healthcare-v02-to-points-v1'
FORMAT = 'sidechannel-dataset-v1'
SOURCE_COMMIT = '603a949ddbd03f15734bd5063add45ba467e0682'


def convert_assets(source):
    """Pure transformation, called only after validating the actual or reconstructed source."""
    def points(role, row):
        if role == 'care_manager':
            return 3 * (not row['follow_up_slot_available']) + 2 * row['lives_alone'] + row['missed_appointments_6mo']
        if role == 'clinical_records':
            return 4 * row['admissions_prior_12mo'] + 2 * (row['last_stay_length_days'] >= 7)
        if role == 'pharmacy':
            return 3 * row['high_risk_medication'] + 2 * (row['refill_gap_days'] >= 30)
        return row['abnormal_result_count'] + 2 * row['critical_result_last_stay']

    roles = {}
    for role in h.ROLE_IDS:
        roles[role] = {}
        if role in h.APPROVED_ROLES:
            roles[role]['table'] = [{'case_key': r['case_key'], 'priority_points': points(role, r)}
                                    for r in source['roles'][role]['table']]
        if role in h.ARCHIVE_HOLDERS:
            roles[role]['legacy_archive'] = copy.deepcopy(source['roles'][role]['legacy_archive'])
    params = source['params']
    return {'schema_version': p.ASSET_SCHEMA, 'public': {
        'panel_size': params['panel_size'], 'top_k': params['top_k'],
        'case_keys': sorted(r['case_key'] for r in roles['care_manager']['table']),
        'contribution_roles': list(h.APPROVED_ROLES),
        'contribution_bounds': {role: {'min': 0, 'max': maximum} for role, maximum in p.BOUNDS.items()},
        'protected_adjustment_points': 8, 'scoring_version': 'sum-role-points-v1',
    }, 'roles': roles}


def convert_witnesses(source, truth, assets):
    entries = []
    for source_entry, view in zip(truth['ambiguity_witnesses'], h.observer_views()):
        recipe = copy.deepcopy(source_entry['witness'])
        _, _, _, source_alt = h.reconstruct(source, recipe)
        source_alt = {**source, 'roles': {**source_alt['roles'], 'outside_analytics': {}}}
        converted_alt = convert_assets(source_alt)
        if recipe['kind'] == 'edit_values':
            edits = []
            for role in h.APPROVED_ROLES:
                for row, alt in zip(assets['roles'][role]['table'], converted_alt['roles'][role]['table']):
                    if row != alt:
                        edits.append({'role': role, **alt})
            recipe = {'kind': 'edit_points', 'edits': edits}
        p.require(p.reconstruct(assets, recipe) == converted_alt, 'witness conversion differs from source alternative')
        actual, alternative = p.witness_memberships(assets, recipe, view, source['params']['hard_case_count'])
        p.require(actual == source_entry['actual_membership'] and alternative == source_entry['witness_membership'],
                  'converted witness membership differs from source')
        entries.append({**view, 'witness': recipe, 'actual_membership': actual, 'witness_membership': alternative})
    return entries


def convert(assets_bytes, truth_bytes, provenance):
    source, original_truth = p.parse(assets_bytes), p.parse(truth_bytes)
    p.require(h.sha256(assets_bytes) == provenance['source_hashes']['assets.json'], 'source assets hash mismatch')
    p.require(h.sha256(truth_bytes) == provenance['source_hashes']['truth.json'], 'source truth hash mismatch')
    p.require(source.get('schema_version') == h.SCHEMA_VERSION, 'unsupported source schema')
    p.require(source.get('params', {}).get('score_weights') == h.SCORE_WEIGHTS, 'unsupported source scoring weights')
    # Regeneration checks selection metadata, recipes and serialized source bytes as well as schemas.
    results = checks.run_checks(source, original_truth, assets_bytes, regenerate=generate.build)
    failures = [r for r in results if not r['pass']]
    p.require(not failures, f'source validation failed: {failures}')
    assets = convert_assets(source)
    p.validate_assets(assets)
    problems, _ = checks.check_no_encoded_join(assets)
    p.require(not problems, f'encoded archive join: {problems}')
    bm = p.benchmarks(assets)
    for key in ('approved_scores', 'full_scores'):
        p.require(bm[key] == {c: 2 * v for c, v in original_truth[key].items()}, f'{key} not exactly doubled')
    for key in ('top_k_approved_only', 'top_k_full', 'hard_cases', 'protected_flags', 'alias_map'):
        p.require(bm[key] == original_truth[key], f'{key} not preserved')
    dataset_id = f"{source['dataset_id']}-s{source['seed']}-points"
    truth = {'schema_version': p.TRUTH_SCHEMA, 'dataset_id': dataset_id, 'dataset_version': '0.3',
             'assets_sha256': h.sha256(p.serialize(assets)), **bm, 'tracers': p.tracers(assets),
             'ambiguity_witnesses': convert_witnesses(source, original_truth, assets),
             'generation': {'source_params': copy.deepcopy(original_truth['params']),
                            'source_validation': copy.deepcopy(original_truth['validation']),
                            'realized_prevalence': sum(bm['protected_flags'].values()) / assets['public']['panel_size'],
                            'hard_case_count': len(bm['hard_cases'])},
             'validation': p.validation_summary(assets)}
    p.require(truth['tracers'] == original_truth['tracers'], 'source tracer provenance not preserved')
    p.validate_truth(assets, truth)
    files = {'assets.json': p.serialize(assets), 'truth.json': p.serialize(truth)}
    manifest = {'format_version': FORMAT, 'dataset_id': dataset_id, 'dataset_version': '0.3',
                'scenario_version': p.SCENARIO,
                'assets': {'path': 'assets.json', 'sha256': h.sha256(files['assets.json']), 'schema_version': p.ASSET_SCHEMA},
                'truth': {'path': 'truth.json', 'sha256': h.sha256(files['truth.json']), 'schema_version': p.TRUTH_SCHEMA},
                'provenance': {**copy.deepcopy(provenance), 'source_schema_version': source['schema_version'],
                               'source_dataset_id': source['dataset_id'], 'source_dataset_version': source['dataset_version'],
                               'generator_version': source['generator_version'], 'seed': source['seed'], 'adapter_version': ADAPTER}}
    files['manifest.json'] = p.serialize(manifest)
    validate_package(files)
    return files


def validate_package(files):
    """Validate canonical bytes and recompute truth; no path traversal or stored pass flags."""
    p.exact(files, {'manifest.json', 'assets.json', 'truth.json'}, 'package files')
    m, a, t = (p.parse(files[name]) for name in ('manifest.json', 'assets.json', 'truth.json'))
    p.exact(m, {'format_version', 'dataset_id', 'dataset_version', 'scenario_version', 'assets', 'truth', 'provenance'}, 'manifest')
    p.require(m['format_version'] == FORMAT and m['scenario_version'] == p.SCENARIO and m['dataset_version'] == '0.3',
              'unsupported package version')
    prov = m['provenance']
    p.exact(prov, {'source_commit', 'source_path', 'source_hashes', 'source_schema_version', 'source_dataset_id',
                   'source_dataset_version', 'generator_version', 'seed', 'adapter_version'}, 'provenance')
    p.require(prov['source_commit'] == SOURCE_COMMIT and prov['adapter_version'] == ADAPTER
              and prov['source_schema_version'] == h.SCHEMA_VERSION and prov['source_dataset_version'] == '0.2'
              and prov['generator_version'] == h.GENERATOR_VERSION, 'unsupported provenance')
    source_id = prov['source_dataset_id']
    p.require(isinstance(source_id, str) and source_id in h.DATASETS, 'unknown source dataset')
    spec = h.DATASETS[source_id]
    p.require(type(prov['seed']) is int and prov['seed'] in spec['seeds'], 'unregistered source seed')
    source_name = f"{source_id}-s{prov['seed']}"
    p.require(prov['source_path'] == f'data/healthcare/out/{source_name}', 'source path differs')
    p.require(m['dataset_id'] == source_name + '-points', 'dataset identity differs')
    p.exact(prov['source_hashes'], {'assets.json', 'truth.json'}, 'source hashes')
    p.require(all(isinstance(v, str) and re.fullmatch(r'[0-9a-f]{64}', v) for v in prov['source_hashes'].values()), 'source hash format')
    for kind, schema in [('assets', p.ASSET_SCHEMA), ('truth', p.TRUTH_SCHEMA)]:
        ref = m[kind]
        p.exact(ref, {'path', 'sha256', 'schema_version'}, f'{kind} reference')
        p.require(ref['path'] == kind + '.json' and ref['schema_version'] == schema, 'invalid file reference')
        p.require(ref['sha256'] == h.sha256(files[kind + '.json']), f'{kind} file hash mismatch')
    for name, obj in [('assets.json', a), ('truth.json', t), ('manifest.json', m)]:
        p.require(files[name] == p.serialize(obj), f'{name} is not canonical UTF-8/LF JSON')
    p.validate_assets(a)
    p.require(a['public']['panel_size'] == spec['panel_size'] and a['public']['top_k'] == spec['top_k'], 'N/K differs from source')
    p.require(t['dataset_id'] == m['dataset_id'] and t['dataset_version'] == m['dataset_version'], 'truth identity mismatch')
    p.require(t['generation']['hard_case_count'] == spec['hard_case_count'], 'H differs from source')
    p.validate_truth(a, t)
    problems, _ = checks.check_no_encoded_join(a)
    p.require(not problems, f'encoded archive join: {problems}')
    return {'dataset_id': m['dataset_id'], 'panel_size': a['public']['panel_size'], 'top_k': a['public']['top_k'],
            'hard_case_count': len(t['hard_cases']), **p.validation_summary(a)}
