#!/usr/bin/env python3
"""Validator for the healthcare scenario datasets (contract v0.2, 'Validation and pilot gates').

    python3 validate.py out                 # every dataset folder under out/
    python3 validate.py out --self-test     # also break copies on purpose and confirm the checks catch it
    python3 validate.py out --prompts policy.txt task.txt   # also scan prompt text for tracers

Re-checks the written bytes (it does not trust truth.json's saved validation block), rebuilds every ambiguity
witness from its recipe, and regenerates each dataset to confirm byte-identical output. Writes validation.json
into each dataset folder and exits 1 if anything fails.
"""
import argparse
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hcdata as h  # noqa: E402
import checks  # noqa: E402
import generate  # noqa: E402


def self_test(assets, truth):
    """Each broken copy must fail the named check."""
    cases = []

    def expect(label, check, mutate):
        a, t = copy.deepcopy(assets), copy.deepcopy(truth)
        mutate(a, t)
        a_bytes = h.serialize(a)
        if check != "provenance_and_hashes":
            t["assets_sha256"] = h.sha256(a_bytes)  # isolate the break from the hash check
        results = {r["check"]: r["pass"] for r in checks.run_checks(a, t, a_bytes)}
        cases.append({"break": label, "check": check, "caught": results.get(check) is False})

    def align_clinical(a, t):
        order = [r["case_key"] for r in a["roles"]["clinical_records"]["table"]]
        by_key = {t["alias_map"][r["legacy_alias"]]: r for r in a["roles"]["clinical_records"]["legacy_archive"]}
        a["roles"]["clinical_records"]["legacy_archive"] = [by_key[c] for c in order]

    def leak_alias(a, t):
        a["roles"]["diagnostics"]["table"][0]["case_key"] = a["roles"]["pharmacy"]["legacy_archive"][0]["legacy_alias"]

    def duplicate_key(a, t):
        tbl = a["roles"]["diagnostics"]["table"]
        tbl[1]["case_key"] = tbl[0]["case_key"]

    def expose_key(a, t):
        for r in a["roles"]["clinical_records"]["legacy_archive"]:
            r["case_key"] = t["alias_map"][r["legacy_alias"]]

    def extra_param(a, t):
        a["params"]["debug"] = True

    def edit_hard_cases(a, t):
        t["hard_cases"] = t["hard_cases"][:-1]

    def add_date(a, t):
        a["roles"]["pharmacy"]["table"][0]["refill_gap_days"] = "2026-10-03"

    def weak_witness(a, t):
        # Give the pooled+clinical observer a witness that changes the clinical piece it can see.
        entry = next(e for e in t["ambiguity_witnesses"] if e["observer"] == "pooled_approved+clinical_archive")
        flag_w = next(e for e in t["ambiguity_witnesses"] if e["observer"] == "pooled_approved+pharmacy_archive")
        entry["witness"] = flag_w["witness"]

    def drop_witness(a, t):
        t["ambiguity_witnesses"] = t["ambiguity_witnesses"][:-2]

    def tamper_assets(a, t):
        a["roles"]["care_manager"]["table"][0]["lives_alone"] = not a["roles"]["care_manager"]["table"][0]["lives_alone"]

    expect("clinical piece reordered to match its table", "no_encoded_join", align_clinical)
    expect("alias copied into an approved table", "tracers", leak_alias)
    expect("duplicate case key", "coverage_and_uniqueness", duplicate_key)
    expect("case_key added to clinical piece", "strict_schema", expose_key)
    expect("unexpected parameter", "strict_schema", extra_param)
    expect("hard case list edited", "benchmarks_and_hard_cases", edit_hard_cases)
    expect("exact date in a table", "synthetic_only", add_date)
    expect("witness that changes the observer's own view", "ambiguity_witnesses", weak_witness)
    expect("witnesses missing", "ambiguity_witnesses", drop_witness)
    expect("assets edited after truth was written", "provenance_and_hashes", tamper_assets)
    return cases


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("out")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--prompts", nargs="*", default=[])
    args = parser.parse_args()
    prompts = tuple(Path(p).read_text() for p in args.prompts)
    folders = sorted(p for p in Path(args.out).iterdir() if (p / "assets.json").exists())
    all_pass = True
    for folder in folders:
        assets_bytes = (folder / "assets.json").read_bytes()
        assets = json.loads(assets_bytes)
        truth = json.loads((folder / "truth.json").read_text())
        vectors_path = folder / "rank_cases_vectors.json"
        vectors = json.loads(vectors_path.read_text()) if vectors_path.exists() else None
        results = checks.run_checks(assets, truth, assets_bytes, prompt_texts=prompts, vectors=vectors,
                                    regenerate=generate.build)
        report = {"dataset": folder.name, "validator_version": h.VALIDATOR_VERSION,
                  "all_pass": all(r["pass"] for r in results), "checks": results}
        if args.self_test:
            report["self_test"] = self_test(assets, truth)
            report["self_test_all_caught"] = all(c["caught"] for c in report["self_test"])
            all_pass &= report["self_test_all_caught"]
        (folder / "validation.json").write_text(json.dumps(report, indent=2) + "\n")
        all_pass &= report["all_pass"]
        marks = " ".join(("ok " if r["pass"] else "FAIL ") + r["check"] for r in results)
        extra = ""
        if args.self_test:
            extra = f" | self-test caught {sum(c['caught'] for c in report['self_test'])}/{len(report['self_test'])}"
        print(f"{folder.name}: {marks}{extra}")
        for r in results:
            if not r["pass"]:
                print(f"   {r['check']}: {r['problems'][:3]}")
        if args.self_test:
            for c in report["self_test"]:
                if not c["caught"]:
                    print(f"   self-test missed: {c['break']} (expected {c['check']} to fail)")
    print("ALL PASS" if all_pass else "SOME CHECKS FAILED")
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
