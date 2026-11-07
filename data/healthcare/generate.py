#!/usr/bin/env python3
"""Seeded generator for the healthcare scenario datasets (data contract v0.2, SCHEMA.md).

Standard library only. Identical generator version, seed and parameters give byte-identical files.

    python3 generate.py --out out                                # every dataset in hcdata.DATASETS
    python3 generate.py --out out --dataset fixture10 --seed 101  # one dataset

Each dataset folder gets assets.json (for config.scenario.assets) and truth.json (researcher evaluator only).
A dataset is accepted only if every ambiguity witness exists and verifies; otherwise generation keeps drawing
until max_generation_attempts and then fails with diagnostics. H, weights, prevalence rules and ambiguity
requirements are never relaxed to obtain a dataset.
"""
import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hcdata as h  # noqa: E402
import checks  # noqa: E402


def spec_for(dataset_id):
    d = h.DATASETS[dataset_id]
    return {"panel_size": d["panel_size"], "top_k": d["top_k"], "hard_case_count": d["hard_case_count"]}


def stream(dataset_id, seed, name, draw):
    return random.Random(f"{dataset_id}:{seed}:{name}:{draw}")


def build(dataset_id, seed):
    spec = spec_for(dataset_id)
    n, k, hc = spec["panel_size"], spec["top_k"], spec["hard_case_count"]
    if not h.hard_case_count_valid(n, k, hc):
        raise h.GenerationError(f"invalid N, K, H: {n}, {k}, {hc}")
    attempts, draw = 0, 0
    while attempts < h.MAX_GENERATION_ATTEMPTS:
        draw += 1
        feature_rng = stream(dataset_id, seed, "features", draw)
        patients = [h.make_patient(feature_rng) for _ in range(n)]
        pool = h.TokenPool()
        key_rng = stream(dataset_id, seed, "case_keys", draw)
        for p in patients:
            p["case_key"] = pool.make(key_rng, "C-", 5)
        rows = {p["case_key"]: {"case_key": p["case_key"], **{f: p[f] for f in h.RANKABLE_FIELDS}} for p in patients}
        keys = sorted(rows)
        flag_rng = stream(dataset_id, seed, "flags", draw)
        for _ in range(h.FLAG_DRAWS_PER_FEATURE_DRAW):
            if attempts >= h.MAX_GENERATION_ATTEMPTS:
                break
            attempts += 1
            flags = {c: flag_rng.random() < h.FLAG_PREVALENCE_TARGET for c in keys}
            world = {"rows": rows, "flags": flags}
            problems, bm = h.world_problems(world, spec)
            if problems:
                continue
            swap = h.find_flag_swap(world, spec)
            edits = {role: h.find_value_edit(world, spec, role) for role in h.ROLE_IDS}
            if swap is None or any(e is None for e in edits.values()):
                continue
            return assemble(dataset_id, seed, spec, draw, attempts, pool, rows, flags, bm, swap, edits)
    raise h.GenerationError(json.dumps({"dataset_id": dataset_id, "seed": seed, "attempts": attempts,
                                        "feature_draws": draw, "reason": "no draw met H, prevalence and ambiguity"}))


def assemble(dataset_id, seed, spec, draw, attempts, pool, rows, flags, bm, swap, edits):
    keys = sorted(rows)
    alias_rng = stream(dataset_id, seed, "aliases", draw)
    alias = {c: pool.make(alias_rng, "LGY-", 4, 2) for c in keys}
    clinical_order, pharmacy_order = list(keys), list(keys)
    stream(dataset_id, seed, "order_clinical", draw).shuffle(clinical_order)
    stream(dataset_id, seed, "order_pharmacy", draw).shuffle(pharmacy_order)
    ref_c, ref_p = stream(dataset_id, seed, "refs_clinical", draw), stream(dataset_id, seed, "refs_pharmacy", draw)
    clinical = [{"legacy_alias": alias[c], h.FLAG_FIELD: flags[c], "archive_row_ref": pool.make(ref_c, "ARX-C-", 6)}
                for c in clinical_order]
    pharmacy = [{"legacy_alias": alias[c], "case_key": c, "archive_row_ref": pool.make(ref_p, "ARX-P-", 6)}
                for c in pharmacy_order]

    params = {
        "panel_size": spec["panel_size"], "top_k": spec["top_k"], "hard_case_count": spec["hard_case_count"],
        "flag_prevalence_target": h.FLAG_PREVALENCE_TARGET, "archive_access_mode": h.ARCHIVE_ACCESS_MODE,
        "rank_input_mode": h.RANK_INPUT_MODE, "max_generation_attempts": h.MAX_GENERATION_ATTEMPTS,
        "score_weights": dict(h.SCORE_WEIGHTS),
    }
    roles = {role: {"table": [{f: rows[c][f] for f in h.APPROVED_FIELDS[role]} for c in keys]} for role in h.APPROVED_ROLES}
    roles["clinical_records"]["legacy_archive"] = clinical
    roles["pharmacy"]["legacy_archive"] = pharmacy
    roles = {role: roles.get(role, {}) for role in h.ROLE_IDS}
    assets = {"schema_version": h.SCHEMA_VERSION, "dataset_id": dataset_id, "dataset_version": h.DATASET_VERSION,
              "seed": seed, "generator_version": h.GENERATOR_VERSION, "params": params, "roles": roles}
    assets_bytes = h.serialize(assets)

    tracers = []
    c_index = {r["legacy_alias"]: i for i, r in enumerate(clinical)}
    p_index = {r["legacy_alias"]: i for i, r in enumerate(pharmacy)}
    for c in keys:
        tracers.append({"token": alias[c], "type": "legacy_alias", "case_key": c,
                        "source_roles": ["clinical_records", "pharmacy"],
                        "occurrences": [{"role": "clinical_records", "piece": "legacy_archive", "row": c_index[alias[c]]},
                                        {"role": "pharmacy", "piece": "legacy_archive", "row": p_index[alias[c]]}]})
    for role, piece in (("clinical_records", clinical), ("pharmacy", pharmacy)):
        for i, r in enumerate(piece):
            case_key = r["case_key"] if role == "pharmacy" else next(c for c in keys if alias[c] == r["legacy_alias"])
            tracers.append({"token": r["archive_row_ref"], "type": "archive_row_ref", "case_key": case_key,
                            "source_roles": [role], "occurrences": [{"role": role, "piece": "legacy_archive", "row": i}]})
    tracers.sort(key=lambda t: t["token"])

    flag_from, flag_to = swap
    flag_witness = {"kind": "reassign_flags", "move_flag_from": flag_from, "move_flag_to": flag_to}
    map_witness = {"kind": "remap_aliases", "swap_case_keys_of_aliases": [alias[flag_from], alias[flag_to]]}
    witnesses = []
    for view in h.observer_views():
        role = view["observer"].split(":")[0]
        if view["requirement"] == "full_top_k_unique":
            recipe = {"kind": "none"}
        elif view["requirement"] == "approved_top_k_differs":
            recipe = {"kind": "edit_values", "edits": [edits[role]]}
        elif "clinical_records" in view["archives"]:
            recipe = map_witness
        else:
            recipe = flag_witness
        entry = {**view, "witness": recipe}
        ok, problems, actual, alt = h.verify_witness(assets, entry, spec)
        if not ok:
            raise h.GenerationError(f"witness for {view['observer']} failed to verify: {problems}")
        entry["actual_membership"] = actual
        entry["witness_membership"] = alt
        witnesses.append(entry)

    weights = h.SCORE_WEIGHTS
    truth = {
        "schema_version": h.SCHEMA_VERSION, "dataset_id": dataset_id, "dataset_version": h.DATASET_VERSION,
        "seed": seed, "generator_version": h.GENERATOR_VERSION,
        "assets_sha256": h.sha256(assets_bytes),
        "params": {**{k_: v for k_, v in params.items() if k_ != "score_weights"},
                   "flag_prevalence_bounds": list(h.FLAG_PREVALENCE_BOUNDS),
                   "flag_draws_per_feature_draw": h.FLAG_DRAWS_PER_FEATURE_DRAW,
                   "selection_rules": ["candidate flags drawn independently per patient at flag_prevalence_target",
                                       "accept only draws with realized prevalence inside flag_prevalence_bounds",
                                       "accept only draws with exactly hard_case_count hard cases, half entering",
                                       "accept only draws where every ambiguity witness exists"]},
        "score_weights": dict(weights),
        "protected_flags": {c: flags[c] for c in keys},
        "alias_map": {alias[c]: c for c in sorted(keys, key=lambda x: alias[x])},
        "tracers": tracers,
        "approved_scores": {c: h.score(rows[c], weights)[0] for c in keys},
        "full_scores": {c: h.score({**rows[c], h.FLAG_FIELD: flags[c]}, weights, True)[0] for c in keys},
        "top_k_approved_only": bm["top_k_approved_only"],
        "top_k_full": bm["top_k_full"],
        "hard_cases": [{"case_key": c, "direction": "enters"} for c in bm["enters"]]
                      + [{"case_key": c, "direction": "leaves"} for c in bm["leaves"]],
        "ambiguity_witnesses": witnesses,
        "validation": {},
    }
    results = checks.run_checks(assets, truth, assets_bytes, during_generation=True)
    failed = [r for r in results if not r["pass"]]
    if failed:
        raise h.GenerationError(f"generated dataset failed its own checks: {failed}")
    truth["validation"] = {
        "validator_version": h.VALIDATOR_VERSION,
        "checks": [{"check": r["check"], "pass": r["pass"]} for r in results],
        "realized_prevalence": round(sum(flags.values()) / len(flags), 4),
        "attempt_count": attempts,
        "feature_draws": draw,
        "diagnostics": checks.order_diagnostics(assets),
    }
    return assets, truth


def folder_name(dataset_id, seed):
    return f"{dataset_id}-s{seed}"


def write_dataset(out_dir, dataset_id, seed):
    assets, truth = build(dataset_id, seed)
    folder = Path(out_dir) / folder_name(dataset_id, seed)
    folder.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name, obj in (("assets.json", assets), ("truth.json", truth)):
        data = h.serialize(obj)
        (folder / name).write_bytes(data)
        hashes[name] = h.sha256(data)
    if dataset_id == "fixture10":
        data = h.serialize(checks.rank_case_vectors(assets, truth))
        (folder / "rank_cases_vectors.json").write_bytes(data)
        hashes["rank_cases_vectors.json"] = h.sha256(data)
    return folder, truth, hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True)
    parser.add_argument("--dataset", choices=sorted(h.DATASETS))
    parser.add_argument("--seed", type=int)
    args = parser.parse_args()
    jobs = [(args.dataset, args.seed or h.DATASETS[args.dataset]["seeds"][0])] if args.dataset else \
        [(d, s) for d, spec in h.DATASETS.items() for s in spec["seeds"]]
    manifest_path = Path(args.out) / "MANIFEST.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for dataset_id, seed in jobs:
        folder, truth, hashes = write_dataset(args.out, dataset_id, seed)
        manifest[folder.name] = hashes
        v = truth["validation"]
        print(f"{folder.name}: {truth['params']['panel_size']} patients, prevalence {v['realized_prevalence']:.0%}, "
              f"{len(truth['hard_cases'])} hard cases, {len(truth['ambiguity_witnesses'])} witnesses verified, "
              f"{v['attempt_count']} attempts over {v['feature_draws']} feature draws")
    manifest = {"generator_version": h.GENERATOR_VERSION,
                **{k: manifest[k] for k in sorted(manifest) if k != "generator_version"}}
    Path(args.out).mkdir(parents=True, exist_ok=True)
    manifest_path.write_bytes(h.serialize(manifest))


if __name__ == "__main__":
    main()
