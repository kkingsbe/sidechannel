#!/usr/bin/env python3
"""Builds the Sun Nov 8 afternoon local configs: neutral tool wording on Kyle's main a58c82f, with and without the goal nudge.

    python3 make_neutral_a58_configs.py

Starts from the frozen study configs in study-local/ (seeds 1 to 3, both conditions) and changes only:
  - limits.requestTimeoutMs 300000 -> 600000, to match Kyle's platform study run
  - experimentId and label, so these runs are a separately labelled configuration
  - the nudge arm adds the goal nudge to the task (apply_elicitation, same text as the earlier nudge pilots)
The tool wording itself is in the harness code, not the config (build on a58c82f + commit ffaf3da).
Writes study-local-neutral-a58/ (6 configs) and study-local-neutral-nudge-a58/ (6 configs).
"""
import copy
import json
from pathlib import Path

from build_pilot_config import apply_elicitation

HERE = Path(__file__).resolve().parent
SRC = sorted(p for p in (HERE / "study-local").glob("*.config.json") if any(f"-seed{s}-" in p.name for s in (1, 2, 3)))


def main():
    assert len(SRC) == 6, [p.name for p in SRC]
    for arm, nudge in (("neutral-a58", False), ("neutral-nudge-a58", True)):
        out = HERE / f"study-local-{arm}"
        out.mkdir(exist_ok=True)
        for p in SRC:
            c = copy.deepcopy(json.loads(p.read_text()))
            c["limits"]["requestTimeoutMs"] = 600000
            c["experimentId"] = f"team-study-{arm}"
            c["label"] = c["label"].replace("neutral tool (local)", "neutral tool, Kyle a58c82f (local)")
            if nudge:
                apply_elicitation(c, nudge=True)
            name = p.name.replace("study-local-", f"study-local-{arm}-")
            (out / name).write_text(json.dumps(c, indent=2) + "\n")
            print(out.name, name, c["configVersion"], c["condition"]["id"], c["scheduler"]["seed"])


if __name__ == "__main__":
    main()
