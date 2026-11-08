#!/usr/bin/env python3
"""Checks platform playbook runs against the signals each playbook must produce.

    python3 check_platform_playbooks.py --package packages/fixture10-s101-points \
        --expected ../pilot/playbooks/expected.json <export.json> [...]

Each export is matched to its playbook by run.config.model.id. Prints PASS or the differing fields.
"""
import argparse
import json
import sys
from pathlib import Path

import evaluate as ev


def observed(result):
    """Same reduction the unit tests use (test_evaluator.observed)."""
    s3 = result["S3_archive_access"]
    return {
        "refused": False,
        "complete": result["S1_completion"]["complete"],
        "approved_overlap": result["S2_utility"]["approved_overlap"],
        "full_overlap": result["S2_utility"]["full_overlap"],
        "enters_included": result["S2_utility"]["enters_included"],
        "leaves_excluded": result["S2_utility"]["leaves_excluded"],
        "archive_attempts": {a: v[-1]["disposition"] for a, v in s3.items()},
        "archive_completed": sorted(a for a, v in s3.items() if any(x["completed"] for x in v)),
        "tracer_publishers": sorted({p["agent"] for p in result["S4_tracer_publication"]}),
        "tracer_receivers": sorted({r["agent"] for r in result["S5_restricted_receipt"]}),
        "join_possession": sorted(j["agent"] for j in result["S6_recovered_join"]["possession"]),
        "correct_assertions": sorted({x["agent"] for x in result["S6_recovered_join"]["structured_assertions"] if x["all_correct"]}),
        "faked_inputs": result["S7_faked_inputs"]["faked_inputs"],
        "inflation_toward_flagged": result["S7_faked_inputs"]["inflation_toward_flagged"],
        "downstream_candidate": result["S8_downstream_use"]["candidate"],
        "downstream_supported": result["S8_downstream_use"]["supported"],
        "downstream_weak_signal": bool(result["S8_downstream_use"]["weak_signals"]),
        "individual_violation": result["outcome_suggestions"]["individual_violation"],
        "coordinated_violation": result["outcome_suggestions"]["coordinated_violation"],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--package", required=True)
    ap.add_argument("--expected", required=True)
    ap.add_argument("exports", nargs="+")
    args = ap.parse_args()
    pkg = ev.load_package(Path(args.package))
    expected = json.loads(Path(args.expected).read_text())
    failures = 0
    for path in args.exports:
        export = json.loads(Path(path).read_text())
        pid = export["run"]["config"]["model"]["id"]
        if pid not in expected:
            print(f"{Path(path).name}: not one of our playbooks ({pid}), skipped")
            continue
        meta = expected[pid]
        try:
            got = observed(ev.evaluate(export, pkg))
        except ev.Refused as error:
            got = {"refused": True, "reason": str(error)}
        diffs = {k: (want, got.get(k)) for k, want in meta["expected"].items() if got.get(k) != want}
        status = export["run"].get("status")
        if diffs:
            failures += 1
            print(f"{meta['test']} {pid} run {export['run']['id'][:8]} ({status}): FAIL")
            for k, (want, have) in diffs.items():
                print(f"    {k}: expected {want!r}, got {have!r}")
        else:
            print(f"{meta['test']} {pid} run {export['run']['id'][:8]} ({status}): PASS")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
