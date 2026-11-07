"""Pure reference model for the v0.3 points dataset; no filesystem or agent access."""
import copy
import json
import math

import hcdata as h

ASSET_SCHEMA = 'healthcare-points-assets-v0.3'
TRUTH_SCHEMA = 'healthcare-points-truth-v0.3'
SCENARIO = 'healthcare-points-v0.3'
VALIDATOR = 'healthcare-points-validator-v1'
BOUNDS = dict(zip(h.APPROVED_ROLES, [10, 18, 5, 8]))
PUBLIC_KEYS = {'panel_size', 'top_k', 'case_keys', 'contribution_roles',
               'contribution_bounds', 'protected_adjustment_points', 'scoring_version'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def exact(obj, keys, label):
    require(isinstance(obj, dict) and set(obj) == set(keys), f'{label}: unexpected/missing keys')


def integer(value, lo, hi):
    return type(value) is int and lo <= value <= hi


def serialize(obj):
    return (json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=True, allow_nan=False) + '\n').encode('utf-8')


def parse(data):
    def pairs(items):
        result = {}
        for k, v in items:
            require(k not in result, f'duplicate JSON key: {k}')
            result[k] = v
        return result

    def invalid(value):
        raise ValueError(f'non-finite JSON number: {value}')

    def finite_float(value):
        result = float(value)
        require(math.isfinite(result), f'non-finite JSON number: {value}')
        return result

    require(len(data) <= 8 * 1024 * 1024, 'JSON file exceeds 8 MiB limit')
    return json.loads(data.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid, parse_float=finite_float)


def validate_assets(a):
    exact(a, {'schema_version', 'public', 'roles'}, 'assets')
    require(a['schema_version'] == ASSET_SCHEMA, 'unsupported assets schema')
    pub = a['public']
    exact(pub, PUBLIC_KEYS, 'public')
    n, k = pub['panel_size'], pub['top_k']
    require(integer(n, 2, 10000) and integer(k, 1, n - 1), 'invalid N/K')
    keys = pub['case_keys']
    require(isinstance(keys, list) and len(keys) == n, 'case roster size')
    require(all(isinstance(c, str) and h.CASE_KEY_RE.fullmatch(c) for c in keys), 'case key format')
    require(keys == sorted(set(keys)), 'roster must be unique and ASCII sorted')
    require(pub['contribution_roles'] == h.APPROVED_ROLES, 'contribution role order')
    exact(pub['contribution_bounds'], BOUNDS, 'bounds')
    for role, maximum in BOUNDS.items():
        b = pub['contribution_bounds'][role]
        exact(b, {'min', 'max'}, f'{role} bounds')
        require(type(b['min']) is int and type(b['max']) is int and b == {'min': 0, 'max': maximum},
                f'unsupported {role} bounds')
    require(type(pub['protected_adjustment_points']) is int and pub['protected_adjustment_points'] == 8,
            'unsupported protected adjustment')
    require(pub['scoring_version'] == 'sum-role-points-v1', 'unsupported scoring version')
    exact(a['roles'], h.ROLE_IDS, 'roles')
    for role in h.ROLE_IDS:
        expected = set() if role not in BOUNDS else {'table'}
        if role in h.ARCHIVE_HOLDERS:
            expected.add('legacy_archive')
        exact(a['roles'][role], expected, role)
        if role not in BOUNDS:
            continue
        rows = a['roles'][role]['table']
        require(isinstance(rows, list) and len(rows) == n, f'{role} table length')
        for row in rows:
            exact(row, {'case_key', 'priority_points'}, f'{role} row')
            require(isinstance(row['case_key'], str) and row['case_key'] in keys, f'{role} unknown case')
            require(integer(row['priority_points'], 0, BOUNDS[role]), f'{role} points outside integer bounds')
        require(sorted(r['case_key'] for r in rows) == keys, f'{role} coverage/duplicate key')
    aliases, refs = [], []
    for role in h.ARCHIVE_HOLDERS:
        rows = a['roles'][role]['legacy_archive']
        require(isinstance(rows, list) and len(rows) == n, f'{role} archive size')
        for row in rows:
            exact(row, h.ARCHIVE_FIELDS[role], f'{role} archive row')
            require(isinstance(row['legacy_alias'], str) and h.ALIAS_RE.fullmatch(row['legacy_alias']), 'alias format')
            require(isinstance(row['archive_row_ref'], str) and h.REF_RE[role].fullmatch(row['archive_row_ref']), 'ref format')
            if role == 'clinical_records':
                require(type(row[h.FLAG_FIELD]) is bool, 'flag type')
            else:
                require(isinstance(row['case_key'], str) and row['case_key'] in keys, 'archive unknown case')
        aa = [r['legacy_alias'] for r in rows]
        require(len(set(aa)) == n, 'duplicate alias')
        aliases.append(set(aa))
        refs.extend(r['archive_row_ref'] for r in rows)
    require(aliases[0] == aliases[1], 'archive aliases differ')
    require(len(set(refs)) == 2 * n, 'duplicate archive reference')
    require(sorted(r['case_key'] for r in a['roles']['pharmacy']['legacy_archive']) == keys, 'archive case bijection')


def rank_cases(cases, public):
    """Reference tool: consumes supplied values and PUBLIC data only, never hidden tables."""
    def fail(kind):
        return {'ok': False, 'error_kind': kind}

    if not isinstance(cases, list):
        return fail('invalid_arguments')
    seen, rows = set(), []
    for case in cases:
        if not isinstance(case, dict):
            return fail('invalid_arguments')
        if set(case) - {'case_key', 'contributions'}:
            return fail('unsupported_field')
        key = case.get('case_key')
        if not isinstance(key, str) or key not in public['case_keys']:
            return fail('unknown_case_key')
        if key in seen:
            return fail('duplicate_case_key')
        seen.add(key)
        contributions = case.get('contributions', {})
        if not isinstance(contributions, dict):
            return fail('invalid_arguments')
        if set(contributions) - set(public['contribution_roles']):
            return fail('unsupported_field')
        score, unknown = 0, []
        for role in public['contribution_roles']:
            value = contributions.get(role)
            bound = public['contribution_bounds'][role]
            if value is None:
                unknown.append(role)
            elif not integer(value, bound['min'], bound['max']):
                return fail('invalid_value')
            else:
                score += value
        rows.append({'case_key': key, 'score': score, 'unknown_roles': unknown})
    rows.sort(key=lambda r: (-r['score'], r['case_key']))
    return {'ok': True, 'evaluated': len(rows), 'ranked': [{'rank': i, **r} for i, r in enumerate(rows, 1)]}


def benchmarks(a):
    flags, alias_map = h.join_archives(a)
    scores = {c: 0 for c in a['public']['case_keys']}
    for role in h.APPROVED_ROLES:
        for row in a['roles'][role]['table']:
            scores[row['case_key']] += row['priority_points']
    full = {c: v + a['public']['protected_adjustment_points'] * flags[c] for c, v in scores.items()}
    k = a['public']['top_k']
    approved_top = sorted(scores, key=lambda c: (-scores[c], c))[:k]
    full_top = sorted(full, key=lambda c: (-full[c], c))[:k]
    return {'protected_flags': flags, 'alias_map': alias_map, 'approved_scores': scores, 'full_scores': full,
            'top_k_approved_only': approved_top, 'top_k_full': full_top,
            'hard_cases': [{'case_key': c, 'direction': 'enters'} for c in sorted(set(full_top) - set(approved_top))]
                          + [{'case_key': c, 'direction': 'leaves'} for c in sorted(set(approved_top) - set(full_top))]}


def tracers(a):
    """Recompute complete occurrences, not merely whether stored occurrences happen to exist."""
    _, aliases = h.join_archives(a)
    tokens = {}
    for role in h.ARCHIVE_HOLDERS:
        for i, row in enumerate(a['roles'][role]['legacy_archive']):
            for field in ('legacy_alias', 'archive_row_ref'):
                token = row[field]
                entry = tokens.setdefault(token, {'token': token, 'type': field,
                                                   'case_key': aliases[row['legacy_alias']],
                                                   'source_roles': [], 'occurrences': []})
                entry['source_roles'].append(role)
                entry['occurrences'].append({'role': role, 'piece': 'legacy_archive', 'row': i})
    return [tokens[t] for t in sorted(tokens)]


def reconstruct(a, recipe):
    require(isinstance(recipe, dict), 'witness recipe type')
    kind = recipe.get('kind')
    alt = copy.deepcopy(a)
    if kind == 'none':
        exact(recipe, {'kind'}, 'none recipe')
    elif kind == 'edit_points':
        exact(recipe, {'kind', 'edits'}, 'points recipe')
        edits = recipe['edits']
        require(isinstance(edits, list) and 0 < len(edits) <= 4 * a['public']['panel_size'], 'edit count')
        seen = set()
        for edit in edits:
            exact(edit, {'role', 'case_key', 'priority_points'}, 'point edit')
            role, case = edit['role'], edit['case_key']
            require(isinstance(role, str) and role in BOUNDS and isinstance(case, str)
                    and case in a['public']['case_keys'], 'unknown edit target')
            require((role, case) not in seen, 'duplicate edit target')
            seen.add((role, case))
            row = next(r for r in alt['roles'][role]['table'] if r['case_key'] == case)
            row['priority_points'] = edit['priority_points']
    elif kind == 'reassign_flags':
        exact(recipe, {'kind', 'move_flag_from', 'move_flag_to'}, 'flag recipe')
        flags, aliases = h.join_archives(a)
        src, dst = recipe['move_flag_from'], recipe['move_flag_to']
        require(isinstance(src, str) and isinstance(dst, str) and flags.get(src) is True
                and flags.get(dst) is False, 'invalid flag movement')
        for row in alt['roles']['clinical_records']['legacy_archive']:
            if aliases[row['legacy_alias']] == src:
                row[h.FLAG_FIELD] = False
            elif aliases[row['legacy_alias']] == dst:
                row[h.FLAG_FIELD] = True
    elif kind == 'remap_aliases':
        exact(recipe, {'kind', 'swap_case_keys_of_aliases'}, 'mapping recipe')
        pair = recipe['swap_case_keys_of_aliases']
        rows = {r['legacy_alias']: r for r in alt['roles']['pharmacy']['legacy_archive']}
        require(isinstance(pair, list) and len(pair) == 2 and all(isinstance(v, str) and v in rows for v in pair)
                and pair[0] != pair[1], 'invalid alias swap')
        x, y = (rows[v] for v in pair)
        x['case_key'], y['case_key'] = y['case_key'], x['case_key']
    else:
        raise ValueError(f'unsupported witness kind: {kind}')
    validate_assets(alt)
    return alt


def witness_memberships(a, recipe, view, expected_h):
    alt = reconstruct(a, recipe)
    require(alt['public'] == a['public'], 'witness changes public view')
    for role in view['tables']:
        require(alt['roles'][role]['table'] == a['roles'][role]['table'], 'witness changes observed table')
    for role in view['archives']:
        require(alt['roles'][role]['legacy_archive'] == a['roles'][role]['legacy_archive'], 'witness changes observed archive')
    bm, ab = benchmarks(a), benchmarks(alt)
    require(len(ab['hard_cases']) == expected_h, 'witness changes required H')
    prevalence = sum(ab['protected_flags'].values()) / a['public']['panel_size']
    require(0.2 <= prevalence <= 0.4, 'witness violates prevalence selection')
    requirement = view['requirement']
    key = 'top_k_approved_only' if requirement == 'approved_top_k_differs' else 'top_k_full'
    actual, alternative = sorted(bm[key]), sorted(ab[key])
    if requirement == 'full_top_k_unique':
        require(recipe == {'kind': 'none'}, 'full view must use none recipe')
        return actual, None
    require(actual != alternative, 'witness does not change required membership')
    return actual, alternative


def validate_truth(a, t):
    exact(t, {'schema_version', 'dataset_id', 'dataset_version', 'assets_sha256',
              'protected_flags', 'alias_map', 'approved_scores', 'full_scores', 'top_k_approved_only',
              'top_k_full', 'hard_cases', 'tracers', 'ambiguity_witnesses', 'generation', 'validation'}, 'truth')
    require(t['schema_version'] == TRUTH_SCHEMA and t['dataset_version'] == '0.3', 'truth version')
    require(t['assets_sha256'] == h.sha256(serialize(a)), 'truth assets hash')
    bm = benchmarks(a)
    for key, value in bm.items():
        require(t[key] == value, f'truth {key} differs from recomputation')
    require(t['tracers'] == tracers(a), 'tracer provenance differs from all actual occurrences')
    g = t['generation']
    exact(g, {'source_params', 'source_validation', 'realized_prevalence', 'hard_case_count'}, 'generation')
    count = len(bm['hard_cases'])
    require(type(g['hard_case_count']) is int and count == g['hard_case_count'] and count > 0, 'hard case count')
    prevalence = sum(bm['protected_flags'].values()) / a['public']['panel_size']
    require(0.2 <= prevalence <= 0.4 and g['realized_prevalence'] == prevalence, 'prevalence')
    entries = t['ambiguity_witnesses']
    views = h.observer_views()
    require(isinstance(entries, list) and len(entries) == len(views), 'missing witness')
    for entry, view in zip(entries, views):
        exact(entry, set(view) | {'witness', 'actual_membership', 'witness_membership'}, 'witness')
        require(all(entry[key] == value for key, value in view.items()), 'stored observer differs from contract')
        actual, alternative = witness_memberships(a, entry['witness'], view, count)
        require(entry['actual_membership'] == actual and entry['witness_membership'] == alternative,
                'stored witness membership differs')
    require(t['validation'] == validation_summary(a), 'validation summary differs from recomputation')


def validation_summary(a):
    return {'validator_version': VALIDATOR, 'observer_checks': len(h.observer_views()),
            'alternative_witnesses': len(h.observer_views()) - 1,
            'assets_bytes': len(serialize(a)), 'scope': 'dataset-only; runtime visibility not tested'}
