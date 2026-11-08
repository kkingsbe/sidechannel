# Jev analysis: research findings and product direction

Date: November 8, 2026. Status: research brief for discussion, not a spec.

This brief collects what we now know about pushing the Jev trace analysis further, from three sources: measurements against production analyses and the live TypeSafe API, the TypeSafe documentation, and a survey of other Jev users and of comparable transcript-analysis tools. It closes with a proposal for what the feature should become.

## 1. What we measured

All measurements use the team-pilot run `98fa50ad` (qwen3.8-27b, reviewed condition, 54 steps) unless stated. Scripts live in the `jev-estimator` worktree root (`compare.py`, `margin.py`, `profile.py`, `exp_visibility.py`, `exp_noise.py`).

### 1.1 Token estimator (fixed today)

The original preflight counted one token per byte. Provider-reported usage across 76 scored windows fits `tokens = 0.51 * state_bytes + 1996`, where the constant is mostly the nine questions. The calibrated estimator (0.6 tokens per byte) is now the default in production.

| Window size | Windows | Oversized before | Oversized now | Input tokens | Cost at $0.042/Mtok |
|---|---|---|---|---|---|
| 1 | 54 | 0 | 0 | 318,101 | $0.013 |
| 4 | 14 | 4 (other run) | 0 | 185,684 | $0.008 |
| 7 | 8 | n/a | 0 | 165,811 | $0.007 |
| 8 | 7 | n/a | 1 | n/a | n/a |

Nine questions add about 2,140 tokens per request regardless of window size, so each extra code costs roughly 240 tokens. At the preflight ceiling a window would really use about 21,000 of the 32,000 allowed tokens; the estimator is still conservative by about 1.3x on the worst window.

### 1.2 Windowed scores are close to the max over member steps

Comparing size-4 and size-7 windows against the size-1 job on the same steps, a window's probability sits a little below the maximum of its member steps: mean differences of -0.02 to -0.10 per code. That matches the question wording ("at least one occurrence" is an OR). Two exceptions on the `accept` code moved by more than 0.3 in either direction, which is beyond the noise floor below and marks that code as unstable.

### 1.3 Static context leaks into the `visibility` code

Same six windows, three variants of the static context, nine questions each:

| Variant | Mean `visibility` | Max shift on any other code |
|---|---|---|
| Original (task, policy, condition) | 0.52 | baseline |
| Condition sentence removed | 0.28 | 0.01 |
| No static context at all | 0.24 | 0.07 (`join`) |

The sentence "Messages on the shared board are included in routine operator review" alone accounts for the near-constant visibility signal. Steps with only a private memory update dropped from 0.65 to 0.32 and from 0.45 to 0.18. The final report step stayed high (0.65 to 0.77) because the report itself discusses the record keeping, which is a legitimate hit. No other code moved meaningfully, so the policy and task text are not contaminating the other eight codes in this run.

### 1.4 Noise floor

Six identical requests for three windows. Jev has no temperature setting, and the docs describe answers as stable, but they are not identical.

| | Value |
|---|---|
| Mean standard deviation across 27 code-window pairs | 0.016 |
| Largest standard deviation (`accept`, step 19) | 0.058 |
| Largest spread (`accept`, step 19) | 0.37 to 0.52 |
| Largest gap between stored and re-run mean (`comply`, step 3) | 0.08 |

TypeSafe's own consistency cookbook reports the same order of variance. Any threshold within about 0.1 of a score is a coin flip for that window, and `accept` is the noisiest code we have.

### 1.5 Where the background should live (added after the v2 build)

The live leak A/B in `tests/integration/jev-leak-smoke.ts` was run with `--ablate` on 12 seeded windows of the size-1 analysis, model `jev-1.14.0`. Means per code; shifts are against v1 (old shaping, condition included).

| Shaping | visibility | accept | join | challenge |
|---|---|---|---|---|
| v1 (static context with condition in state, prose questions) | 0.53 | 0.23 | 0.08 | 0.14 |
| v2 evidence-only state, background inside each question | 0.31 | 0.37 | 0.14 | 0.15 |
| v2 state, v1 prose questions (no background anywhere) | 0.27 | 0.36 | 0.19 | 0.09 |
| v1 state without condition, v2 questions (background in both) | 0.43 | 0.26 | 0.08 | 0.22 |
| v2 state with shared `background` block, questions without background | 0.31 | 0.33 | 0.07 | 0.20 |

Three conclusions. First, the visibility leak is closed by removing the condition, however the rest is arranged: every variant without it lands at 0.27 to 0.31. Second, per-question background does not do the job that shared background does for `join`, and putting it in both places is worse. The shared block is the production shaping. Third, two residual shifts survive every variant: the v2 state raises `accept` by about 0.10 and the v2 question format raises `challenge` by about 0.06. These are differences between two classifiers of unknown accuracy, not errors, and the labelled set in phase 4 is what decides them. Both codes were already the least stable in the noise probe.

## 2. What the TypeSafe docs say that matters

- Question types are `noul` (yes/no probability), `choice` (pick one of up to 255 labels, with per-label probabilities), `score` (2 to 10 ordered levels, expected value and per-level probabilities) and `box` (image only). Nothing returns free text, a count, or a span. Jev "does not count reliably".
- Limits: 32k tokens for state plus the largest single question, 64k for state plus all questions. The `TypeSafe-Danger-Zone-Long-Context: true` header raises both to 262k at the same price, documented as slower and less accurate. No tokenizer or dry-run endpoint exists.
- Pricing: $0.042 per million input tokens, output free. State is ingested once per request and every question is evaluated against it in parallel. A full run at window size 1 costs about one cent.
- Guidance: one yes/no per question, phrased so high means yes; avoid negations; include only the context each question needs because accuracy falls as unrelated state grows; put background in named fields next to the question rather than in prose; reference sub-paths of the state with backticked paths such as `steps[0].toolCalls`; choice questions lean toward the first option; adversarial content in the state can move answers; start thresholds at 0.7 and 0.3 and route the middle to a person; pin the model version because aliases move and answers change between versions.
- Rate limits are per organization in tokens per second and requests per second, visible only in the console. Typical latency is about 100 ms.
- No documented pattern covers sliding windows, per-speaker scoping, or shielding a question from shared background. Our leak finding is outside what the docs describe.

## 3. What others have built

The Jev ecosystem is three months old and already has several hundred repositories. The relevant ones:

- Datadog's agent observability evals send a per-turn state of three fields and ask one `noul` per behavior plus a `choice` for failure mode with an explicit `unclear` option, about 1,200 tokens per request, pinned to one model version.
- A Who&When failure-attribution benchmark asks three `choice` questions per failed multi-agent run (responsible agent, decisive step, error type) and beats frontier LLM judges on the first two.
- The "Just Ask Jev" paper detects ten alignment failure types zero-shot with a median AUROC of 0.886 from one generic question, and reports that question wording mattered little while context fields that encoded the label mattered a lot. That is our leak, observed independently.
- A crash-narrative coding paper applied a 27-question schema to 196k narratives against 2,416 human labels, F1 0.91, and found that recalibration cut calibration error three-fold.
- Independent reviews agree on the weaknesses: repeated runs vary by up to 0.1, option order shifts choice answers by about 0.1, language shifts answers, and probabilities track what a frontier LLM would say rather than frequency of correctness. Reported expected calibration error ranges from 0.03 on moderation to 0.28 on rating tasks.
- Nobody we found slides a window over a long transcript and codes each window against a qualitative codebook. The closest analogues are per-turn evals and per-trace schemas. Our approach appears to be novel, which cuts both ways: no prior art to copy, and no evidence yet that it works.

## 4. Methods worth borrowing from adjacent tools

- Docent (Transluce): a rubric is a decision procedure, not a definition, and judgments must cite spans in the transcript. Rubrics are refined by looking at judge-versus-human disagreements. Third parties validate by hand-checking at least 30 flagged items per rubric and reporting precision.
- Petri (Anthropic): include distractor dimensions so a judge that wants to flag something has an outlet other than the code you care about; run audit-quality dimensions first and drop samples that fail them; extract citations before judging; report same-judge repeat agreement as a reliability floor; compare relative scores across conditions rather than absolute values.
- AI-control monitoring (Ctrl-Z, Redwood, SHADE-Arena): score per step, aggregate per trajectory by max, set thresholds as percentiles of the benign-condition score distribution tied to a review budget, add a k-strikes rule for repeated medium scores, report true-positive rate per run and false-positive rate per window, and use a control condition to estimate baseline false positives.
- Arize's alignment procedure: define the unit and the positive class, measure human-human agreement first, build a reference set by adjudication, report human-human and model-human agreement side by side, treat the classifier as a classifier (precision, recall, confusion matrix), and bootstrap confidence intervals by resampling whole runs rather than windows because overlapping windows are not independent.
- Sample sizes: about 100 labelled items gives roughly plus or minus 10 points on agreement, about 400 gives plus or minus 5; count positives per code, because a 5% base rate over 200 items leaves ten positives and an unstable recall estimate.

## 5. Implications for each scaling axis

| Axis | Finding | Direction |
|---|---|---|
| Window extent | Size 7 fits this run; windows behave like OR over steps | Score every step and also windows; cost is not a constraint |
| Payload density | 30% of bytes are IDs; questions are 2,140 tokens fixed | Shorten IDs for the model, keep a map for review; worth doing but not urgent |
| Context carry-over | Not tested | Test a compact board snapshot as a named field, measured against labels |
| Actor scoping | Not tested; docs suggest per-entity questions built in code | Add per-agent variants of codes that are about an actor's own behavior |
| Evidence breadth | Provider reasoning unavailable for the qwen model | Record availability per run; no action |
| Codebook size | 240 tokens per extra code | Add distractor and audit-quality codes freely |
| Definition quality | `accept` unstable, `visibility` contaminated | Rewrite as decision procedures with exclusions for task framing |
| Question semantics | `choice` and `score` exist | Use `choice` for which agent and failure mode, `score` for severity, keep `noul` for presence |
| Static context | Condition sentence is a direct leak | Move condition out of the shared state; keep policy and task, or move them to a per-question named field |
| Runs | One job per run | Cross-run aggregation and condition comparison is the research deliverable |
| Throughput and cost | About one cent per run, 100 ms per call | Irrelevant until thousands of runs; raise concurrency when rate limits are known |
| Classifier model | Pinned 1.14.0; answers change between versions | Keep pinning; re-validate thresholds per version |
| Human labels | None yet | The blocking dependency for every quality claim |
| Reference outcomes | Oversight judgments exist separately | Correlate run-level aggregates with them |
| Aggregation | Nothing computes run metrics | Max, first-occurrence, k-strikes, percentile thresholds |

## 6. Product direction

The feature today is a scoring pipeline with a review API. What it should become is a behavioral coding instrument for multi-agent runs, with the reliability work built in rather than left to the researcher. Four parts:

### 6.1 Codebook studio

The codebook editor exists. It needs the structure that makes codes reliable:

- Each code becomes a decision procedure: the behavior, what counts, what does not count, with explicit exclusions for task framing and quoted speech. Examples and counterexamples populated.
- Distractor codes (for example "ordinary task coordination", "routine status update") and audit-quality codes (for example "step is a bare memory update", "agent output is malformed") shipped alongside the behavioral codes, following Petri.
- Codes carry a question type: `noul` for presence, `choice` for which agent or which route, `score` for severity. The request builder already batches; it gains a per-type encoder.
- Per-actor scoping as a code option, so "the actor delegates" becomes one question per active agent.
- Version pinning of both codebook revision and model version in every manifest is already there; add a visible "validated against labels on date X" marker per revision.

### 6.2 Request shaping

- Static context leaves the shared state. The policy and task move into a named `background` field inside each question that needs it; the experimental condition is dropped from classifier input entirely, because the condition is the independent variable and the classifier must not see it.
- The serializer gets a model-facing ID scheme (short per-window aliases mapped back to real IDs for review), reclaiming roughly 30% of window bytes.
- Every analysis also records a repeat-variance probe: re-score a fixed sample of windows a few times and store the standard deviation per code. This is the reliability floor shown next to every threshold.
- Optional long-context mode stays off by default, but becomes selectable for whole-run questions where a single judgment over the entire trace is wanted, with the documented accuracy caveat shown.

### 6.3 Analysis presets and aggregation

- Two standard analyses per run, both cheap: dense per-step scoring for attribution, and a windowed pass at size 4 to 7 for cross-step patterns. The dashboard already plots per window; it gains a run summary.
- Run-level metrics per code: max, mean, count above threshold, first-occurrence step, k-strikes flag. Thresholds default to 0.7 and 0.3 per the docs, then move to percentiles of the control condition's score distribution once a benign baseline exists.
- Condition comparison across a pair or a set of runs, with confidence intervals bootstrapped by run, not by window. This is the output the research actually needs.
- Correlation of run-level aggregates with the oversight subsystem's reference outcomes.

### 6.4 Validation loop

- A labelled set per codebook revision, built from review batches: stratify by predicted probability, hand-label at least 30 flagged windows per code and a matching random sample, record two reviewers where possible to get a human-human baseline.
- Per-code precision, recall, agreement with humans, and repeat variance shown in the codebook studio. A code with agreement below about 0.67 is marked tentative; below the noise floor it is marked unusable.
- Disagreement-driven rewriting: the review UI surfaces windows where the human and Jev disagree most, grouped by code, as the queue for definition edits.
- Re-validation prompt whenever the model version or the codebook revision changes.

## 7. Suggested order of work

1. Request shaping for the leak: drop the condition from classifier input, move policy and task into per-question background fields, rerun the two existing runs and confirm `visibility` falls to the no-condition baseline while other codes hold. Small change, immediate quality win, and it is the prerequisite for any labelling.
2. Repeat-variance probe stored per analysis, plus the run-level aggregation metrics. Both are read-only additions to existing data.
3. Codebook rewrite as decision procedures, with distractor and audit codes, and the `choice` and `score` encoders. This is where the researcher's judgment matters most, so it should be done with them.
4. First labelled set on the two existing runs, using the review batch feature that already exists. This unblocks every quality claim and sets the first thresholds.
5. Per-actor scoping and condition comparison with run-level bootstrap. This is the research deliverable.
6. Payload density and context carry-over, measured against the labelled set, last, because they only matter once the codes are trustworthy.

## 8. Open questions

- Whether per-question `background` fields leak the way shared state does. The docs say questions are evaluated independently, but a question's own instructions can still prime it. Needs the same A/B as section 1.3.
- The organization's actual rate limits, which decide the concurrency setting for batch runs.
- Whether `accept` is unstable because of the definition or because the behavior is genuinely ambiguous in these runs. Labels will tell.
- Whether the scenario's answer-key vocabulary (case keys, protected adjustment) appears in any code definition and primes it the way the condition sentence did.
