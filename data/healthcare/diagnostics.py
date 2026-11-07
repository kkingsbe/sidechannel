#!/usr/bin/env python3
"""Flag-predictability diagnostic across the preregistered batch (contract v0.2, 'Validation and pilot gates').

    python3 diagnostics.py --out out

Generates hcdata.DIAGNOSTIC_BATCH in memory (never written, never used for study runs) and reports:
  1. Held-out predictability of the flag from all approved features: naive Bayes trained leave-one-panel-out,
     scored by AUC against the prevalence-aware baseline of 0.5, with a panel bootstrap 95% interval.
  2. Selection effect: how well the approved score alone predicts the flag, and the flag rate by approved-rank
     band. Accepting only panels with exactly H hard cases can push flagged patients toward the top-K boundary.
  3. Realized prevalence across panels versus the 0.30 target.
This is a diagnostic, not a gate, and it does not claim any single panel is free of predictive correlation.
"""
import argparse
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hcdata as h  # noqa: E402
import generate  # noqa: E402

BINS = {
    "missed_appointments_6mo": [0, 1], "admissions_prior_12mo": [0, 1], "last_stay_length_days": [3, 6],
    "active_medication_count": [4, 8], "refill_gap_days": [14, 29], "abnormal_result_count": [0, 2],
}


def discretize(row):
    out = {}
    for field in h.RANKABLE_FIELDS:
        value = row[field]
        if field in BINS:
            out[field] = sum(value > edge for edge in BINS[field])
        else:
            out[field] = value
    return out


def fit_nb(examples):
    counts = {True: {}, False: {}}
    totals = {True: 0, False: 0}
    for x, y in examples:
        totals[y] += 1
        for f, v in x.items():
            counts[y].setdefault(f, {}).setdefault(v, 0)
            counts[y][f][v] += 1
    values = {f: {v for y in (True, False) for v in counts[y].get(f, {})} for f in h.RANKABLE_FIELDS}
    return counts, totals, values


def nb_log_odds(model, x):
    counts, totals, values = model
    lo = math.log((totals[True] + 1) / (totals[False] + 1))
    for f, v in x.items():
        k = len(values[f]) or 1
        p1 = (counts[True].get(f, {}).get(v, 0) + 1) / (totals[True] + k)
        p0 = (counts[False].get(f, {}).get(v, 0) + 1) / (totals[False] + k)
        lo += math.log(p1 / p0)
    return lo


def auc(scored):
    pos = [s for s, y in scored if y]
    neg = [s for s, y in scored if not y]
    if not pos or not neg:
        return None
    wins = sum(1.0 if p > q else 0.5 if p == q else 0.0 for p in pos for q in neg)
    return wins / (len(pos) * len(neg))


def bootstrap_ci(panels_scored, reps=1000, seed="diagnostics-bootstrap"):
    rng = random.Random(seed)
    values = []
    for _ in range(reps):
        sample = [s for _ in panels_scored for s in rng.choice(panels_scored)]
        a = auc(sample)
        if a is not None:
            values.append(a)
    values.sort()
    return [round(values[int(0.025 * len(values))], 3), round(values[int(0.975 * len(values)) - 1], 3)]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    dataset_id = h.DIAGNOSTIC_BATCH["dataset_id"]
    k = h.DATASETS[dataset_id]["top_k"]
    panels = []
    for seed in h.DIAGNOSTIC_BATCH["seeds"]:
        assets, truth = generate.build(dataset_id, seed)
        rows = h.merged_rows({r: assets["roles"][r]["table"] for r in h.APPROVED_ROLES})
        flags = truth["protected_flags"]
        order = [c for c in sorted(rows, key=lambda c: (-truth["approved_scores"][c], c))]
        panels.append({"seed": seed, "rows": rows, "flags": flags, "approved_rank": {c: i + 1 for i, c in enumerate(order)},
                       "approved_scores": truth["approved_scores"], "prevalence": truth["validation"]["realized_prevalence"]})

    nb_scored, score_scored = [], []
    for i, test in enumerate(panels):
        train = [(discretize(p["rows"][c]), p["flags"][c]) for j, p in enumerate(panels) if j != i for c in p["rows"]]
        model = fit_nb(train)
        nb_scored.append([(nb_log_odds(model, discretize(test["rows"][c])), test["flags"][c]) for c in test["rows"]])
        score_scored.append([(test["approved_scores"][c], test["flags"][c]) for c in test["rows"]])

    bands = {f"ranks 1-{k}": (1, k), f"ranks {k + 1}-{2 * k}": (k + 1, 2 * k), f"ranks {2 * k + 1}+": (2 * k + 1, 10 ** 6)}
    band_rates = {}
    for name, (lo, hi) in bands.items():
        sel = [p["flags"][c] for p in panels for c in p["rows"] if lo <= p["approved_rank"][c] <= hi]
        band_rates[name] = {"patients": len(sel), "flag_rate": round(sum(sel) / len(sel), 3)}
    prevalences = [p["prevalence"] for p in panels]
    report = {
        "batch": h.DIAGNOSTIC_BATCH, "generator_version": h.GENERATOR_VERSION, "panels": len(panels),
        "patients": sum(len(p["rows"]) for p in panels),
        "held_out_flag_prediction_from_approved_features": {
            "method": "naive Bayes, leave-one-panel-out, binned features, Laplace smoothing",
            "auc": round(auc([s for ps in nb_scored for s in ps]), 3), "auc_95ci_panel_bootstrap": bootstrap_ci(nb_scored),
            "baseline_auc": 0.5},
        "selection_effect": {
            "approved_score_predicting_flag_auc": round(auc([s for ps in score_scored for s in ps]), 3),
            "auc_95ci_panel_bootstrap": bootstrap_ci(score_scored),
            "flag_rate_by_approved_rank_band": band_rates},
        "realized_prevalence": {"target": h.FLAG_PREVALENCE_TARGET, "mean": round(sum(prevalences) / len(prevalences), 3),
                                "min": min(prevalences), "max": max(prevalences)},
        "interpretation_note": "AUC near 0.5 means approved features carry no usable signal about the flag. A selection "
                               "AUC above 0.5 comes from accepting only panels with exactly H hard cases, not from how "
                               "flags are drawn.",
    }
    Path(args.out).mkdir(parents=True, exist_ok=True)
    (Path(args.out) / "diagnostics.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k_: v for k_, v in report.items() if k_ not in ("batch", "interpretation_note")}, indent=2))


if __name__ == "__main__":
    main()
