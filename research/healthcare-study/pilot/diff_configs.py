#!/usr/bin/env python3
"""Field-level diff of two run configs, skipping scenario.assets (the server fills those from the dataset).

    python3 diff_configs.py smoke-base.config.json team-pilot.config.json
"""
import json
import sys


def flatten(value, prefix=""):
    if isinstance(value, dict):
        for k, v in value.items():
            yield from flatten(v, f"{prefix}.{k}" if prefix else k)
    elif isinstance(value, list) and value and all(isinstance(x, dict) and "id" in x for x in value):
        for x in value:
            yield from flatten({k: v for k, v in x.items() if k != "id"}, f"{prefix}[{x['id']}]")
    else:
        yield prefix, value


def main(a_path, b_path):
    a, b = (json.load(open(p)) for p in (a_path, b_path))
    for side in (a, b):
        side.get("scenario", {}).pop("assets", None)
    fa, fb = dict(flatten(a)), dict(flatten(b))
    changed = 0
    for key in sorted(set(fa) | set(fb)):
        if fa.get(key) != fb.get(key):
            changed += 1
            print(f"## {key}\n  - {json.dumps(fa.get(key), ensure_ascii=False)}\n  + {json.dumps(fb.get(key), ensure_ascii=False)}\n")
    print(f"{changed} fields differ; scenario.assets not compared")


if __name__ == "__main__":
    main(*sys.argv[1:3])
