#!/usr/bin/env python3
"""Turns a run export into a readable transcript for hand coding.

    python3 transcript_md.py <export.json> [--blind ID] [--out file.md]

Shows only observable evidence, as the protocol asks: board posts, list updates, the tools each agent used (with the
arguments that matter), and the end of task reports. Private reasoning and working memory are left out. Routine reads
(read_board, read_artifact, list_agents, end_turn) are collapsed into one line per turn.

--blind ID hides the run id, model, condition and the condition sentence, and labels the transcript with ID instead.
Agents can still mention operator review on the board; that text is left as written, since it is evidence.
"""
import argparse
import json
from pathlib import Path

ROUTINE = {"read_board", "read_artifact", "list_agents", "end_turn", "read_role_data", "update_working_memory"}


def render(export, blind=None):
    run, events = export["run"], export["events"]
    cfg = run["config"]
    cond_text = (cfg.get("condition") or {}).get("text", "")
    lines = []
    if blind:
        lines += [f"# Transcript {blind}", "", "Blind copy: run id, model and condition are hidden.", ""]
    else:
        lines += [f"# Transcript {run['id'][:8]}", "",
                  f"Model {cfg['model']['id']} | condition {cfg['condition']['id']} | design {cfg.get('configVersion')} | "
                  f"dataset {cfg['scenario']['datasetId']} | seed {cfg['scheduler']['seed']} | status {run['status']}", ""]
    lines += ["Observable evidence only (board, list, tool calls, reports). Private reasoning is not shown.", ""]
    turn_key, routine = None, {}

    def flush():
        if routine:
            lines.append("  - routine: " + ", ".join(f"{k} x{v}" for k, v in sorted(routine.items())))
            routine.clear()

    for e in events:
        key = (e.get("round"), e.get("turn"), e.get("agentId"))
        if e["type"] == "turn_started":
            flush()
            turn_key = key
            lines += ["", f"## Round {e.get('round')}, turn {e.get('turn')}: {e.get('agentId')}"]
        elif e["type"] == "tool_requested":
            call = e["data"]["call"]
            name, args = call["name"], call.get("arguments") or {}
            if name in ROUTINE:
                routine[name] = routine.get(name, 0) + 1
            elif name == "post_board":
                pass  # shown from board_post below, with its sequence number
            elif name == "update_artifact":
                entries = args.get("entries") or []
                lines.append("  - updates the shared list:")
                for x in entries:
                    lines.append(f"    {x.get('rank')}. {x.get('case_key')} {'(uncertain)' if x.get('uncertain') else '(certain)'}: {x.get('note', '')}")
            elif name == "rank_cases":
                lines.append(f"  - runs rank_cases on {len(args.get('cases') or [])} cases")
            elif name == "submit_report":
                pass  # shown in the reports section
            else:
                lines.append(f"  - calls {name}: {json.dumps(args, ensure_ascii=False)[:600]}")
        elif e["type"] == "tool_result":
            res = e["data"]
            if res.get("disposition") in ("denied", "invalid"):
                lines.append(f"  - that call was {res['disposition']}: {(res.get('result') or {}).get('error')}")
        elif e["type"] == "board_post":
            m = (e["data"].get("after") or {})
            text = m.get("text", "")
            if blind and cond_text:
                text = text.replace(cond_text, "[condition sentence]")
            lines.append(f"  - posts to the board (#{m.get('sequence')}):")
            lines += ["    > " + ln for ln in text.splitlines() if ln.strip()]
    flush()
    final = next((e["data"]["after"]["value"]["entries"] for e in reversed(events) if e["type"] == "artifact_updated"), [])
    lines += ["", "## Final shared list", ""]
    lines += [f"{x.get('rank')}. {x.get('case_key')} {'(uncertain)' if x.get('uncertain') else '(certain)'}: {x.get('note', '')}" for x in final] or ["(no list)"]
    lines += ["", "## End of task reports (private to the operator)", ""]
    for rep in run.get("reports", []):
        p = rep.get("parsed") or {}
        lines += [f"### {rep.get('agentId')}", ""]
        for k in ("ownActions", "observations", "limitations"):
            lines += [f"**{k}:** {p.get(k, '(missing)')}", ""]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export")
    ap.add_argument("--blind")
    ap.add_argument("--out")
    args = ap.parse_args()
    md = render(json.loads(Path(args.export).read_text()), args.blind)
    if args.out:
        Path(args.out).write_text(md)
        print("wrote", args.out, f"({len(md.splitlines())} lines)")
    else:
        print(md)


if __name__ == "__main__":
    main()
