#!/usr/bin/env python3
"""Converts our test playbooks (make_playbooks.py) into Kyle's sidechannel-playbook-v1 format and checks them.

    python3 to_platform_playbooks.py --package packages/fixture10-s101-points \
        --run-config ../pilot/playbook-base.config.json --out ../pilot/playbooks

Writes one playbook per test (T7 is skipped: it needs run assets that differ from the dataset, which the
platform cannot produce) plus expected.json, the signals each run must show. Each call becomes its own step,
so a later call can read an earlier result; "$latest" becomes {"$from": "read_artifact", "$path": "value.version"}.

The checks mirror packages/contracts/src/playbook/contracts.ts (strict schema) and
packages/domain/src/playbook/package.ts validatePlaybookForConfig (roles, rounds, steps), plus the run's
per-role allowedTools and toolCallsPerTurn allowance.
"""
import argparse
import json
import re
from pathlib import Path

import make_playbooks as mp

ROLES = ["care_manager", "clinical_records", "pharmacy", "diagnostics", "outside_analytics"]
SLUGS = {"T1": "compliant", "T2": "denied-archive", "T3": "solo-archive", "T4": "leak-join", "T5": "faked-inputs",
         "T6": "manual-reorder", "T8": "missing-diagnostics"}
END_TURN = {"steps": [{"calls": [{"name": "end_turn"}]}]}
IDENT = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")
TOOL = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def convert_args(args):
    if args is None:
        return None
    out = dict(args)
    if out.get("expectedVersion") == "$latest":
        out["expectedVersion"] = {"$from": "read_artifact", "$path": "value.version"}
    return out


def convert(book, dataset_id, scenario_version):
    rounds = {}
    for turn in book["turns"]:
        rounds.setdefault(turn["agent"], {})[turn["round"]] = turn["calls"]
    roles = {}
    for role in ROLES:
        mine = rounds.get(role, {})
        last = max(mine) if mine else 0
        turns = []
        for r in range(1, last + 1):
            calls = mine.get(r)
            if not calls:
                turns.append(END_TURN)
                continue
            steps = []
            for call in calls:
                c = {"name": call["name"]}
                a = convert_args(call.get("arguments"))
                if a is not None:
                    c["arguments"] = a
                steps.append({"calls": [c]})
            turns.append({"steps": steps})
        roles[role] = {
            "turns": turns,
            "default_turn": END_TURN,
            "report": {
                "ownActions": f"Scripted playbook {book['id']} ({book['title']}).",
                "observations": "Scripted transcript, not spontaneous behaviour.",
                "limitations": "Validation run for the truth-based evaluator; not a study observation.",
            },
        }
    return {
        "format_version": "sidechannel-playbook-v1",
        "playbook_id": f"team-{book['id'].lower()}-{SLUGS[book['id']]}",
        "playbook_version": "1",
        "display_name": f"Team {book['id']}: {book['title']}"[:120],
        "description": "Truth-based evaluator test from data/healthcare/evaluator/make_playbooks.py; expected signals in EVALUATOR.md section 7.",
        "scenario_version": scenario_version,
        "dataset_id": dataset_id,
        "roles": roles,
    }


def walk_operators(value, where, errors):
    if isinstance(value, dict):
        dollar = [k for k in value if k.startswith("$")]
        if dollar:
            if "$stringify" in value:
                if set(value) != {"$stringify"}:
                    errors.append(f"{where}: $stringify must be alone")
            elif "$from" in value:
                if not set(value) <= {"$from", "$path", "$nth", "$default"}:
                    errors.append(f"{where}: unknown $from keys {sorted(value)}")
            else:
                errors.append(f"{where}: unsupported operator {dollar}")
        for k, v in value.items():
            walk_operators(v, f"{where}.{k}", errors)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            walk_operators(v, f"{where}[{i}]", errors)


def check(pb, config):
    errors = []
    top = {"format_version", "playbook_id", "playbook_version", "display_name", "description", "scenario_version", "dataset_id", "roles"}
    if set(pb) - top:
        errors.append(f"unknown top-level keys {sorted(set(pb) - top)}")
    if pb["format_version"] != "sidechannel-playbook-v1":
        errors.append("format_version")
    if not IDENT.match(pb["playbook_id"]):
        errors.append("playbook_id pattern")
    if not VERSION.match(pb["playbook_version"]):
        errors.append("playbook_version pattern")
    if not 1 <= len(pb["display_name"]) <= 120 or len(pb.get("description", "")) > 2000:
        errors.append("display_name/description length")
    if pb["scenario_version"] != config["scenario"]["version"]:
        errors.append("scenario_version differs from run")
    if pb["dataset_id"] != config["scenario"]["datasetId"]:
        errors.append("dataset_id differs from run")
    allowed = {r["id"]: set(r["allowedTools"]) for r in config["roles"]}
    if sorted(pb["roles"]) != sorted(allowed):
        errors.append("roles differ from run roles")
    rounds, max_steps, allowance = config["scheduler"]["rounds"], config["limits"]["maxModelStepsPerTurn"], config["scheduler"]["toolCallsPerTurn"]
    for role, spec in pb["roles"].items():
        if set(spec) - {"turns", "default_turn", "report"}:
            errors.append(f"{role}: unknown role keys")
        if set(spec["report"]) != {"ownActions", "observations", "limitations"} or not all(spec["report"].values()):
            errors.append(f"{role}: report needs three non-empty strings")
        if len(spec["turns"]) > rounds:
            errors.append(f"{role}: {len(spec['turns'])} turns > {rounds} rounds")
        for i, turn in enumerate(spec["turns"] + [spec["default_turn"]]):
            if set(turn) != {"steps"} or not turn["steps"]:
                errors.append(f"{role} turn {i + 1}: needs non-empty steps")
            if len(turn["steps"]) > max_steps:
                errors.append(f"{role} turn {i + 1}: {len(turn['steps'])} steps > {max_steps}")
            calls = [c for s in turn["steps"] for c in s["calls"]]
            if len(calls) > allowance:
                errors.append(f"{role} turn {i + 1}: {len(calls)} calls > allowance {allowance}")
            for s in turn["steps"]:
                if set(s) != {"calls"}:
                    errors.append(f"{role} turn {i + 1}: unknown step keys")
                for c in s["calls"]:
                    if set(c) - {"id", "name", "arguments"} or not TOOL.match(c["name"]):
                        errors.append(f"{role} turn {i + 1}: bad call {c.get('name')}")
                    if c["name"] not in allowed.get(role, set()):
                        errors.append(f"{role} turn {i + 1}: {c['name']} not in this role's allowedTools")
                    walk_operators(c.get("arguments"), f"{role}.{c['name']}", errors)
                    for e in (c.get("arguments") or {}).get("entries", []):
                        if len(e.get("note", "")) > 200:
                            errors.append(f"{role}: artifact note over 200 code points")
    if config.get("phase") == "study":
        errors.append("playbook runs may not be study runs")
    return errors


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--package", required=True)
    ap.add_argument("--run-config", required=True, help="the config the playbook runs will use (roles, limits, scheduler)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    assets, truth = mp.load(args.package)
    manifest = json.loads((Path(args.package) / "manifest.json").read_text())
    config = json.loads(Path(args.run_config).read_text())
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    expected, failed = {}, 0
    for book in mp.build(assets, truth):
        if book["id"] not in SLUGS:
            print(book["id"], "skipped (local-only refusal test)")
            continue
        pb = convert(book, manifest["dataset_id"], config["scenario"]["version"])
        errors = check(pb, config)
        failed += bool(errors)
        (out / f"{pb['playbook_id']}.json").write_text(json.dumps(pb, indent=1) + "\n")
        expected[pb["playbook_id"]] = {"test": book["id"], "title": book["title"], "expected": book["expected"]}
        steps = max(len(t["steps"]) for r in pb["roles"].values() for t in r["turns"] or [END_TURN])
        print(f"{book['id']} -> {pb['playbook_id']}: {'PASS' if not errors else 'FAIL ' + '; '.join(errors)} (max steps per turn {steps})")
    (out / "expected.json").write_text(json.dumps(expected, indent=1) + "\n")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
