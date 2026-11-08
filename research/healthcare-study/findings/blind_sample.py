#!/usr/bin/env python3
"""Draws a blind sample of runs for hand coding.

    python3 blind_sample.py --launch-prefix study-prod --n 4 --seed 7

Picks N completed runs at random, half from each condition, gives each a random ID, and writes a blind readable
transcript per run to findings/blind/<ID>.md (run id, model and condition hidden; see evaluator/transcript_md.py).
The answer key (ID to run and condition) goes to private/blind-key.json, outside findings/, and must not be shared with
the coders or pushed. The seed makes the draw reproducible for the key holder.
"""
import argparse
import json
import random
import string
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evaluator"))
import transcript_md  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--experiment", help="keep runs whose config experimentId matches")
    ap.add_argument("--launch-prefix", help="keep runs whose platform launchKey starts with this (Kyle's study: study-prod)")
    ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    if not (args.experiment or args.launch_prefix):
        ap.error("give --experiment, --launch-prefix or both")
    rng = random.Random(args.seed)
    index = json.loads((ROOT / "transcripts" / "index.json").read_text())
    pool = {"reviewed": [], "excluded": []}
    for item in index:
        if item["status"] != "completed" or item["provider"] != "adaption":
            continue
        if args.launch_prefix and not (item.get("launch_key") or "").startswith(args.launch_prefix):
            continue
        export = json.loads((ROOT / "transcripts" / item["file"]).read_text())
        if not args.experiment or export["run"]["config"].get("experimentId") == args.experiment:
            pool[item["condition"]].append(item)
    per = args.n // 2
    if min(len(v) for v in pool.values()) < per:
        raise SystemExit(f"not enough completed runs per condition: { {k: len(v) for k, v in pool.items()} }")
    picked = rng.sample(pool["reviewed"], per) + rng.sample(pool["excluded"], args.n - per)
    rng.shuffle(picked)
    out = ROOT / "findings" / "blind"
    out.mkdir(parents=True, exist_ok=True)
    key = []
    for item in picked:
        bid = "B-" + "".join(rng.choice(string.ascii_uppercase + string.digits) for _ in range(4))
        export = json.loads((ROOT / "transcripts" / item["file"]).read_text())
        (out / f"{bid}.md").write_text(transcript_md.render(export, blind=bid))
        key.append({"blind_id": bid, "run": item["run"], "condition": item["condition"], "model": item["model"], "seed": item["seed"]})
    private = ROOT / "private"
    private.mkdir(exist_ok=True)
    (private / "blind-key.json").write_text(json.dumps({"experiment": args.experiment, "launch_prefix": args.launch_prefix,
                                                        "draw_seed": args.seed, "key": key}, indent=1) + "\n")
    print("blind transcripts:", ", ".join(k["blind_id"] for k in key), "in findings/blind/ | key in private/blind-key.json (do not share)")


if __name__ == "__main__":
    main()
