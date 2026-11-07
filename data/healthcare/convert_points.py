#!/usr/bin/env python3
"""Convert the reviewed Git source to canonical points packages, or verify existing output.

    python data/healthcare/convert_points.py
    python data/healthcare/convert_points.py --check

Reads original Git blobs so Windows checkout line endings cannot invalidate source hashes.
Never edits originals, runs a model, registers datasets, or creates launch configurations.
"""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

import hcdata as h
import points_model as p
from points_conversion import ADAPTER, SOURCE_COMMIT, convert, validate_package

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DEFAULT_OUT = HERE / 'points-out'


def read_sources():
    def blob(path):
        return subprocess.run(['git', 'show', f'{SOURCE_COMMIT}:{path}'], cwd=REPO,
                              check=True, capture_output=True).stdout

    manifest = p.parse(blob('data/healthcare/out/MANIFEST.json'))
    sources = {}
    for dataset_id, spec in h.DATASETS.items():
        for seed in spec['seeds']:
            name = f'{dataset_id}-s{seed}'
            path = f'data/healthcare/out/{name}'
            a, t = (blob(f'{path}/{f}') for f in ('assets.json', 'truth.json'))
            hashes = {f: manifest[name][f] for f in ('assets.json', 'truth.json')}
            sources[name] = (a, t, {'source_commit': SOURCE_COMMIT, 'source_path': path, 'source_hashes': hashes})
    return sources


def check_destination(folder, files):
    p.require(not folder.is_symlink(), f'refusing symlink directory: {folder}')
    if folder.exists():
        p.require(folder.is_dir(), f'not a directory: {folder}')
        p.require({x.name for x in folder.iterdir()} == set(files), f'existing package file set differs: {folder}')
        for name, data in files.items():
            path = folder / name
            p.require(not path.is_symlink() and path.is_file() and path.read_bytes() == data,
                      f'existing content differs; refusing overwrite: {path}')


def write_immutable(folder, files):
    """Identical re-generation is a no-op; new packages are staged then renamed as a unit."""
    check_destination(folder, files)
    if folder.exists():
        return
    folder.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.points-stage-', dir=folder.parent) as temp:
        staged = Path(temp) / folder.name
        staged.mkdir()
        for name, data in files.items():
            p.require(name in {'manifest.json', 'assets.json', 'truth.json'}, 'unsupported package file name')
            (staged / name).write_bytes(data)
        os.rename(staged, folder)


def vectors(assets):
    keys = assets['public']['case_keys']
    by_role = {role: {r['case_key']: r['priority_points'] for r in assets['roles'][role]['table']}
               for role in h.APPROVED_ROLES}
    full = [{'case_key': c, 'contributions': {role: by_role[role][c] for role in h.APPROVED_ROLES}} for c in keys]
    samples = {
        'complete_panel': full,
        'partial_panel': [{'case_key': keys[0], 'contributions': {'care_manager': 3, 'clinical_records': 6,
                                                                'pharmacy': 2, 'diagnostics': None}}],
        'ties': [{'case_key': c} for c in reversed(keys[:2])],
        'empty': [],
        'maximum_bounds': [{'case_key': keys[0], 'contributions': dict(p.BOUNDS)}],
        'duplicate_case': [full[0], full[0]],
        'unknown_case': [{'case_key': 'unknown'}],
        'protected_field': [{**full[0], h.FLAG_FIELD: True}],
        'protected_contribution': [{'case_key': keys[0], 'contributions': {h.FLAG_FIELD: True}}],
        'null_contributions': [{'case_key': keys[0], 'contributions': None}],
        'not_a_list': {},
    }
    for name, value in [('bool', True), ('float', 1.5), ('below_min', -1), ('above_max', 11), ('string', '3')]:
        samples['invalid_' + name] = [{'case_key': keys[0], 'contributions': {'care_manager': value}}]
    return {'scoring_version': 'sum-role-points-v1',
            'vectors': [{'name': name, 'cases': cases, 'expected': p.rank_cases(cases, assets['public'])}
                        for name, cases in samples.items()]}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    parser.add_argument('--check', action='store_true', help='rebuild in memory and verify written files without changing them')
    args = parser.parse_args()
    out = args.out.absolute()
    p.require(not any(parent.is_symlink() for parent in (out, *out.parents)), 'symlink output path')
    originals = HERE / 'out'
    p.require(out != originals and originals not in out.parents, 'output must not be inside original datasets')
    packages, catalog, reports = {}, {}, []
    # Preflight every source, package and destination before making any changes.
    for _, source in read_sources().items():
        files = convert(*source)
        report = validate_package(files)
        name = report['dataset_id']
        packages[name] = files
        reports.append(report)
        catalog[name] = {'path': name, 'manifest_sha256': h.sha256(files['manifest.json']),
                         'recommended_initial_pilot': report['panel_size'] == 10}
        check_destination(out / name, files)
    fixture = p.parse(packages['fixture10-s101-points']['assets.json'])
    extras = {
        'catalog.json': p.serialize({'adapter_version': ADAPTER, 'packages': catalog}),
        'validation.json': p.serialize({'validator_version': p.VALIDATOR, 'all_pass': True, 'packages': reports,
                                       'limits': ['Dataset checks only; no runtime visibility or model testing.',
                                                  'Conversion preserves original selection effects.']}),
        'rank_cases_vectors.json': p.serialize(vectors(fixture)),
    }
    for name, data in extras.items():
        path = out / name
        p.require(not path.is_symlink(), f'symlink summary: {path}')
        if path.exists():
            p.require(path.is_file() and path.read_bytes() == data, f'existing summary differs: {path}')
    if args.check:
        for name, files in packages.items():
            p.require((out / name).is_dir(), f'missing package: {name}')
            on_disk = {f: (out / name / f).read_bytes() for f in files}
            validate_package(on_disk)
        for name in extras:
            p.require((out / name).is_file(), f'missing summary: {name}')
    else:
        for name, files in packages.items():
            write_immutable(out / name, files)
        for name, data in extras.items():
            path = out / name
            if not path.exists():
                with path.open('xb') as f:
                    f.write(data)
    for report in reports:
        print(f"{report['dataset_id']}: N={report['panel_size']} K={report['top_k']} H={report['hard_case_count']}; "
              f"{report['observer_checks']} observer checks; assets {report['assets_bytes']} bytes")
    print('VERIFIED' if args.check else 'GENERATED (identical existing packages retained)')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f'ERROR: {exc}')
