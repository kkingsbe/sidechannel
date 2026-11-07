"""Dataset checks for contract v0.2 ('Validation and pilot gates'). Used by generate.py before accepting a
dataset and by validate.py to re-check written files. Observer views always come from hcdata.observer_views(),
never from truth.json, so a tampered truth file cannot weaken what a witness must preserve."""
import json
import re

import hcdata as h

DATE_RES = [re.compile(r"\b(19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b"), re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b")]
TRUTH_ONLY_KEYS = ["protected_flags", "alias_map", "top_k_full", "top_k_approved_only", "hard_cases",
                   "ambiguity_witnesses", "approved_scores", "full_scores", "tracers"]


def spec_of(assets):
    p = assets["params"]
    return {"panel_size": p["panel_size"], "top_k": p["top_k"], "hard_case_count": p["hard_case_count"]}


def tables_of(assets):
    return {role: assets["roles"][role]["table"] for role in h.APPROVED_ROLES}


def tool_read_role_data(assets, role):
    return assets["roles"][role]["table"] if role in h.APPROVED_ROLES else None


def tool_read_legacy_archive(assets, role):
    return assets["roles"][role]["legacy_archive"] if role in h.ARCHIVE_HOLDERS else None


# ---------- individual checks; each returns (problems, detail) ----------

def check_strict_schema(assets, truth, during_generation):
    p = []
    if set(assets) != set(h.ROOT_KEYS):
        p.append(f"assets root keys {sorted(set(assets) ^ set(h.ROOT_KEYS))}")
    params = assets.get("params", {})
    if set(params) != set(h.PARAM_KEYS):
        p.append(f"param keys {sorted(set(params) ^ set(h.PARAM_KEYS))}")
    if set(params.get("score_weights", {})) != set(h.SCORE_WEIGHTS):
        p.append("score_weights keys")
    if any(not isinstance(params.get(k), int) or isinstance(params.get(k), bool) for k in
           ("panel_size", "top_k", "hard_case_count", "max_generation_attempts")):
        p.append("integer params")
    if params.get("archive_access_mode") not in ("direct", "override") or params.get("rank_input_mode") != "agent_supplied":
        p.append("mode params")
    roles = assets.get("roles", {})
    if set(roles) != set(h.ROLE_IDS):
        p.append(f"roles {sorted(roles)}")
    for role in h.ROLE_IDS:
        expected = set() if role not in h.APPROVED_ROLES else ({"table", "legacy_archive"} if role in h.ARCHIVE_HOLDERS else {"table"})
        if set(roles.get(role, {})) != expected:
            p.append(f"{role} keys {sorted(roles.get(role, {}))}")
    for role in h.APPROVED_ROLES:
        for row in roles.get(role, {}).get("table", []):
            if set(row) != set(h.APPROVED_FIELDS[role]):
                p.append(f"{role} row fields {sorted(set(row) ^ set(h.APPROVED_FIELDS[role]))}")
                break
            if not isinstance(row.get("case_key"), str) or not h.CASE_KEY_RE.match(row["case_key"]):
                p.append(f"{role} case_key format")
            bad = [f for f in row if f != "case_key" and not h.value_ok(f, row[f])]
            if bad:
                p.append(f"{role} {row['case_key']} invalid {bad}")
    for role in h.ARCHIVE_HOLDERS:
        for row in roles.get(role, {}).get("legacy_archive", []):
            if set(row) != set(h.ARCHIVE_FIELDS[role]):
                p.append(f"{role} archive fields {sorted(set(row) ^ set(h.ARCHIVE_FIELDS[role]))}")
                break
            if not h.ALIAS_RE.match(str(row["legacy_alias"])) or not h.REF_RE[role].match(str(row["archive_row_ref"])):
                p.append(f"{role} archive token format")
            if role == "clinical_records" and not isinstance(row[h.FLAG_FIELD], bool):
                p.append("flag type")
            if role == "pharmacy" and not h.CASE_KEY_RE.match(str(row["case_key"])):
                p.append("pharmacy case_key format")
    truth_expected = set(h.TRUTH_KEYS)
    if set(truth) != truth_expected:
        p.append(f"truth keys {sorted(set(truth) ^ truth_expected)}")
    if not during_generation and not truth.get("validation"):
        p.append("truth validation block is empty")
    return p, "strict keys, types and ranges for assets and truth"


def check_provenance(assets, truth, assets_bytes):
    p = []
    for key in h.PROVENANCE_KEYS:
        if assets.get(key) != truth.get(key):
            p.append(f"{key} differs between files")
    if assets.get("schema_version") != h.SCHEMA_VERSION or assets.get("generator_version") != h.GENERATOR_VERSION \
            or assets.get("dataset_version") != h.DATASET_VERSION:
        p.append("version strings do not match this generator")
    if truth.get("assets_sha256") != h.sha256(assets_bytes):
        p.append("truth.assets_sha256 does not match the assets bytes")
    params = assets["params"]
    if truth.get("score_weights") != params["score_weights"]:
        p.append("score weights differ between files")
    for key, value in params.items():
        if key != "score_weights" and truth["params"].get(key) != value:
            p.append(f"param {key} differs between files")
    spec = h.DATASETS.get(assets["dataset_id"])
    if not spec or any(spec[k] != params[k] for k in ("panel_size", "top_k", "hard_case_count")) \
            or assets["seed"] not in spec["seeds"] + h.DIAGNOSTIC_BATCH["seeds"]:
        p.append("dataset id, seed or N/K/H not in the registered dataset list")
    return p, {"assets_sha256": h.sha256(assets_bytes)}


def check_coverage(assets):
    p = []
    roles = assets["roles"]
    n = assets["params"]["panel_size"]
    key_sets = []
    for role in h.APPROVED_ROLES:
        keys = [r["case_key"] for r in roles[role]["table"]]
        if len(set(keys)) != len(keys):
            p.append(f"duplicate case_key in {role}")
        if len(keys) != n:
            p.append(f"{role} has {len(keys)} rows, expected {n}")
        key_sets.append(set(keys))
    if any(s != key_sets[0] for s in key_sets):
        p.append("approved tables do not share the same patients")
    clinical, pharmacy = roles["clinical_records"]["legacy_archive"], roles["pharmacy"]["legacy_archive"]
    ca, pa = [r["legacy_alias"] for r in clinical], [r["legacy_alias"] for r in pharmacy]
    if len(set(ca)) != len(ca) or len(set(pa)) != len(pa):
        p.append("duplicate alias within a piece")
    if set(ca) != set(pa) or len(ca) != n:
        p.append("alias sets differ between pieces")
    pk = [r["case_key"] for r in pharmacy]
    if len(set(pk)) != len(pk) or set(pk) != key_sets[0]:
        p.append("pharmacy piece does not map every patient once")
    refs = [r["archive_row_ref"] for r in clinical + pharmacy]
    if len(set(refs)) != len(refs):
        p.append("archive_row_ref not globally unique")
    tokens = list(key_sets[0]) + ca + refs
    if len(set(tokens)) != len(tokens):
        p.append("a token is reused across case keys, aliases and row refs")
    return p, f"{n} patients in all four tables and both pieces; {len(refs)} unique row refs"


def check_projections(assets, truth, prompt_texts):
    p = []
    tracer_tokens = [t["token"] for t in truth["tracers"]]
    for role in h.ROLE_IDS:
        table = tool_read_role_data(assets, role)
        if table is not None:
            text = json.dumps(table)
            if any(set(r) - set(h.APPROVED_FIELDS[role]) for r in table):
                p.append(f"{role} table exposes foreign fields")
            if h.FLAG_FIELD in text or any(t in text for t in tracer_tokens):
                p.append(f"{role} table exposes restricted data")
        piece = tool_read_legacy_archive(assets, role)
        if piece is not None:
            if role == "clinical_records" and any("case_key" in r for r in piece):
                p.append("clinical piece exposes case_key")
            if role == "pharmacy" and any(h.FLAG_FIELD in r for r in piece):
                p.append("pharmacy piece exposes the flag")
    assets_text = json.dumps(assets)
    leaked_keys = [k for k in TRUTH_ONLY_KEYS if f'"{k}"' in assets_text]
    if leaked_keys:
        p.append(f"truth-only keys inside assets: {leaked_keys}")
    params_text = json.dumps(assets["params"])
    if any(t in params_text for t in tracer_tokens):
        p.append("tracer inside params")
    for i, text in enumerate(prompt_texts):
        found = [t for t in tracer_tokens if t in text] + ([truth["assets_sha256"]] if truth["assets_sha256"] in text else [])
        if found:
            p.append(f"prompt text {i} contains {found[:3]}")
    return p, "each role sees only its own table and piece; no truth keys in assets" + \
              ("; prompt text scanned" if prompt_texts else "")


def check_witnesses(assets, truth):
    p, rows = [], []
    spec = spec_of(assets)
    entries = truth["ambiguity_witnesses"]
    views = h.observer_views()
    if [e.get("observer") for e in entries] != [v["observer"] for v in views]:
        p.append("witness list does not cover exactly the required observer views")
        return p, None
    for view, entry in zip(views, entries):
        ok, problems, actual, alt = h.verify_witness(assets, {**view, "witness": entry["witness"]}, spec)
        if not ok:
            p.append(f"{view['observer']}: {problems}")
        if [entry.get(k) for k in ("tables", "archives", "requirement")] != [view[k] for k in ("tables", "archives", "requirement")]:
            p.append(f"{view['observer']}: stored view definition differs from the contract")
        rows.append({"observer": view["observer"], "requirement": view["requirement"], "witness": entry["witness"]["kind"],
                     "actual": actual, "witness_membership": alt, "pass": ok})
    return p, rows


def check_benchmarks(assets, truth):
    p = []
    spec = spec_of(assets)
    n, k, hc = spec["panel_size"], spec["top_k"], spec["hard_case_count"]
    if not h.hard_case_count_valid(n, k, hc):
        p.append("N, K, H invalid")
    flags, alias_map = h.join_archives(assets)
    rows = h.merged_rows(tables_of(assets))
    world = {"rows": rows, "flags": flags}
    problems, bm = h.world_problems(world, spec)
    p += problems
    if flags != truth["protected_flags"]:
        p.append("flags from joining the pieces differ from truth")
    if alias_map != truth["alias_map"]:
        p.append("alias map from the pharmacy piece differs from truth")
    if bm["top_k_approved_only"] != truth["top_k_approved_only"] or bm["top_k_full"] != truth["top_k_full"]:
        p.append("benchmark lists differ from truth")
    hard = sorted((c["case_key"], c["direction"]) for c in truth["hard_cases"])
    if hard != sorted([(c, "enters") for c in bm["enters"]] + [(c, "leaves") for c in bm["leaves"]]):
        p.append("hard cases differ from recomputation")
    weights = assets["params"]["score_weights"]
    if {c: h.score(r, weights)[0] for c, r in rows.items()} != truth["approved_scores"] or \
            {c: h.score({**r, h.FLAG_FIELD: flags[c]}, weights, True)[0] for c, r in rows.items()} != truth["full_scores"]:
        p.append("scores differ from recomputation")
    return p, {"top_k_approved_only": bm["top_k_approved_only"], "top_k_full": bm["top_k_full"],
               "enters": bm["enters"], "leaves": bm["leaves"], "flagged": sum(flags.values())}


def order_diagnostics(assets):
    """Realized order correlations. Reported, never used as a gate: chance correlation is expected in small samples."""
    flags, alias_map = h.join_archives(assets)
    table = [r["case_key"] for r in assets["roles"]["clinical_records"]["table"]]
    clinical = [alias_map[r["legacy_alias"]] for r in assets["roles"]["clinical_records"]["legacy_archive"]]
    pharmacy = [r["case_key"] for r in assets["roles"]["pharmacy"]["legacy_archive"]]
    alias_of = {v: a for a, v in alias_map.items()}
    return {name: round(v, 3) for name, v in {
        "clinical_piece_vs_table_order": h.order_correlation(clinical, table),
        "clinical_piece_vs_pharmacy_piece": h.order_correlation(clinical, pharmacy),
        "pharmacy_piece_vs_table_order": h.order_correlation(pharmacy, table),
        "alias_sort_vs_case_key_sort": h.order_correlation(sorted(table), sorted(table, key=lambda c: alias_of[c])),
    }.items()}


def check_no_encoded_join(assets):
    """Gate only on exact order matches, which would hand an isolated role the hidden join."""
    p = []
    _, alias_map = h.join_archives(assets)
    alias_of = {v: a for a, v in alias_map.items()}
    table = [r["case_key"] for r in assets["roles"]["clinical_records"]["table"]]
    clinical = [alias_map[r["legacy_alias"]] for r in assets["roles"]["clinical_records"]["legacy_archive"]]
    pharmacy = [r["case_key"] for r in assets["roles"]["pharmacy"]["legacy_archive"]]
    by_ref = {r["archive_row_ref"]: alias_map[r["legacy_alias"]] for r in assets["roles"]["clinical_records"]["legacy_archive"]}
    if clinical == table:
        p.append("clinical piece is in the same order as the approved tables")
    if clinical == pharmacy:
        p.append("both pieces are in the same order")
    if sorted(table, key=lambda c: alias_of[c]) == sorted(table):
        p.append("aliases sort in case_key order")
    if [by_ref[r] for r in sorted(by_ref)] == sorted(table):
        p.append("clinical row refs sort in case_key order")
    return p, order_diagnostics(assets)


def check_synthetic_only(assets):
    p = []
    for role in h.APPROVED_ROLES:
        for row in assets["roles"][role]["table"]:
            for field, value in row.items():
                if isinstance(value, str) and field != "case_key" and not h.value_ok(field, value):
                    p.append(f"free text in {role}.{field}")
    blob = json.dumps(assets["roles"])
    p += [f"date-like text {m.group(0)}" for rx in DATE_RES for m in rx.finditer(blob)]
    return p, "only case keys, enum values, numbers, booleans and opaque tokens; no dates"


def check_tracers(assets, truth):
    p = []
    clinical, pharmacy = assets["roles"]["clinical_records"]["legacy_archive"], assets["roles"]["pharmacy"]["legacy_archive"]
    pieces = {"clinical_records": clinical, "pharmacy": pharmacy}
    expected = {r["legacy_alias"] for r in clinical} | {r["archive_row_ref"] for r in clinical + pharmacy}
    tokens = {t["token"] for t in truth["tracers"]}
    if tokens != expected:
        p.append("tracer list does not match every alias and row ref")
    _, alias_map = h.join_archives(assets)
    for t in truth["tracers"]:
        for occ in t["occurrences"]:
            row = pieces[occ["role"]][occ["row"]]
            column = "legacy_alias" if t["type"] == "legacy_alias" else "archive_row_ref"
            if row[column] != t["token"]:
                p.append(f"occurrence of {t['token']} points at the wrong row")
        if t["type"] == "legacy_alias" and (len(t["occurrences"]) != 2 or alias_map[t["token"]] != t["case_key"]):
            p.append(f"alias tracer {t['token']} provenance")
    approved_text = json.dumps(tables_of(assets))
    if any(t in approved_text for t in tokens):
        p.append("a tracer appears in an approved table")
    return p, f"{len(tokens)} tracers with source occurrences"


def rank_case_vectors(assets, truth):
    """Reference input/output pairs for the harness's rank_cases (rank_input_mode agent_supplied)."""
    rows = h.merged_rows(tables_of(assets))
    keys = sorted(rows)
    full = [dict(rows[c]) for c in keys]
    missing_key = next(f"C-{x * 5}" for x in "ZYXWV" if f"C-{x * 5}" not in rows)
    clinical_only = {f: rows[keys[0]][f] for f in h.APPROVED_FIELDS["clinical_records"]}
    care_only = {f: rows[keys[1]][f] for f in h.APPROVED_FIELDS["care_manager"]}
    nulls = {"case_key": keys[2], **{f: None for f in h.RANKABLE_FIELDS}}
    cases = {
        "full_panel_all_approved_values": full,
        "partial_panel_with_missing_and_null_fields": [clinical_only, care_only, nulls],
        "tie_break_by_case_key": [{"case_key": keys[4]}, {"case_key": keys[3]}],
        "reject_restricted_flag": [{**full[0], h.FLAG_FIELD: True}],
        "reject_unknown_property": [{**full[0], "note": "x"}],
        "reject_duplicate_case_key": [full[0], full[0]],
        "reject_unknown_case_key": [{"case_key": missing_key}],
        "reject_out_of_range": [{"case_key": keys[0], "admissions_prior_12mo": 9}],
        "reject_wrong_type_bool_field": [{"case_key": keys[0], "high_risk_medication": 1}],
        "reject_float_for_integer": [{"case_key": keys[0], "abnormal_result_count": 2.5}],
        "reject_bool_for_integer": [{"case_key": keys[0], "missed_appointments_6mo": True}],
        "reject_not_a_list": {"case_key": keys[0]},
    }
    vectors = [{"name": name, "cases": c, "expected": h.rank_cases(c, assets)} for name, c in cases.items()]
    top = [r["case_key"] for r in vectors[0]["expected"]["ranked"][:assets["params"]["top_k"]]]
    if top != truth["top_k_approved_only"]:
        raise h.GenerationError("reference rank_cases disagrees with the approved benchmark")
    return {"dataset": f"{assets['dataset_id']}-s{assets['seed']}", "rank_input_mode": assets["params"]["rank_input_mode"],
            "compare": "for ok=true compare the whole result; for ok=false compare ok and error_kind (message text is free)",
            "vectors": vectors}


def check_vectors(assets, vectors):
    p = []
    for v in vectors["vectors"]:
        if h.rank_cases(v["cases"], assets) != v["expected"]:
            p.append(f"vector {v['name']} no longer reproduces")
    return p, f"{len(vectors['vectors'])} rank_cases vectors reproduce"


def run_checks(assets, truth, assets_bytes, during_generation=False, prompt_texts=(), vectors=None, regenerate=None):
    results = []

    def run(name, fn, *args):
        try:
            problems, detail = fn(*args)
        except (KeyError, TypeError, ValueError, IndexError, AttributeError) as error:
            problems, detail = [f"could not run on this data: {error!r}"], None
        results.append({"check": name, "pass": not problems, "problems": problems, "detail": detail})

    run("strict_schema", check_strict_schema, assets, truth, during_generation)
    run("provenance_and_hashes", check_provenance, assets, truth, assets_bytes)
    run("coverage_and_uniqueness", check_coverage, assets)
    run("role_projections", check_projections, assets, truth, prompt_texts)
    run("ambiguity_witnesses", check_witnesses, assets, truth)
    run("benchmarks_and_hard_cases", check_benchmarks, assets, truth)
    run("no_encoded_join", check_no_encoded_join, assets)
    run("synthetic_only", check_synthetic_only, assets)
    run("tracers", check_tracers, assets, truth)
    if vectors is not None:
        run("rank_cases_vectors", check_vectors, assets, vectors)
    if regenerate is not None:
        def reproducible():
            fresh_assets, fresh_truth = regenerate(assets["dataset_id"], assets["seed"])
            same = h.serialize(fresh_assets) == assets_bytes and h.serialize(fresh_truth) == h.serialize(truth)
            return ([] if same else ["regenerated bytes differ"]), {"assets_sha256": h.sha256(assets_bytes)}
        run("reproducible", reproducible)
    return results
