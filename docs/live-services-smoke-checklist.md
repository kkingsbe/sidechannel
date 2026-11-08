# Live service smoke test through the dashboard

Status: acceptance checklist, November 7, 2026. Live results are pending. This expands the earlier healthcare implementation smoke to cover the connected inference and analysis services. The user performs the actual live dashboard steps.

## Scope and pass criteria

Exercise the real application with the 10-case healthcare fixture: dashboard and API, MongoDB, experiment worker, Adaption inference, persisted memory and traces, Jev analysis through the analysis worker, independent oversight inference, and researcher inspection/review/export. If the team uses the Cloudflare address, verify that address as well as the local application.

The acceptance path is:

```text
Dashboard -> API -> Mongo queue -> experiment worker -> Adaption
  -> persisted healthcare evidence, artifact and reports
  -> dashboard analysis launch -> analysis worker -> Jev -> stored classifications
  -> separate dashboard oversight launch -> monitor provider -> stored judgments
  -> dashboard inspection, review, reload and export
```

Jev and oversight are independent consumers of permitted evidence. The arrow sequence above is the order of testing, not a dependency that supplies Jev scores to the oversight model.

Scripted tests and provider mocks are prerequisites, not evidence that live integrations work. A real provider connectivity probe alone is also insufficient: jobs must use the dashboard/API queue path and results must reappear in the dashboard. No particular violation, concealment finding or high classifier score is required to pass.

## 1. Service preparation

Before the user starts:

- Run the API/static dashboard host, MongoDB, experiment worker **and analysis/monitor worker** against the intended application database. Check actual process readiness; a saved worker registration is not a heartbeat.
- Confirm the intended build is deployed to all three application services. Preserve existing research records and Mongo volumes.
- Confirm the six datasets are registered and the healthcare preset resolves `fixture10-s101-points` version `0.3`.
- Supply `ADAPTION_API_KEY` to the API for model discovery and to the experiment worker for inference. For an Adaption-backed oversight model, the analysis worker needs that key too.
- Supply `TYPESAFE_API_KEY` (or the supported `TYPESAFE_AI_API_KEY` alias) to the analysis worker. Confirm environment wiring without printing credentials.
- Select a real hosted Adaption model available to the account. Select the Jev model and a separate oversight model explicitly; missing availability is a visible blocker, not a reason to substitute scripted output.
- Confirm the codebook and monitor definition forms have suitable editable definitions. Verify analysis/review records use the same run IDs and database as the experiment evidence.
- Keep each subsystem's budgets independent. The experiment's 120,000-token input allowance does not set Jev's limit or the oversight projection limits.

The previous implementation handoff documents scripted checks and local service observations. Recheck current readiness rather than treating those observations as a live service certificate.

## 2. Live healthcare experiment via Adaption

In the ordinary dashboard, use the healthcare preset, choose **Live Adaption · pilot**, select the 10-case fixture and an available hosted model, then review the frozen settings before launching the matched pair. The current documented starting execution profile is three rounds, eight admitted calls per turn and eight model steps per turn; these remain configurable pilot settings.

Confirm the two conditions preserve all non-condition settings. Input defaults to 120,000 tokens, with a separately configured output allowance and documented counting/headroom policy. Model changes must not silently reduce the allowances.

Pass evidence:

- Both runs enter the ordinary queue and the experiment worker makes real Adaption requests with the selected model/settings.
- Round/turn progress and real tool proposals/results appear. Board publication and actual receipt remain distinguishable.
- Private memory persists independently for each agent/run. Requests, responses, available usage and trace references are recorded without credentials.
- The artifact freezes and reports finish, or any failure/incomplete state is shown honestly. To mark the full successful path passed, obtain completed runs with valid final reports; retain any failed attempts separately.
- The healthcare artifact renderer and researcher evaluation display the actual submitted output. A live model can produce a wrong or incomplete ranking; record that as task performance rather than silently repairing it or claiming an infrastructure fault without evidence.
- Reloading the page preserves the same run, evidence and results.

Record run IDs, pair ID, exact model, build revision, dataset hash and effective budgets. Do not reuse the scripted evidence IDs as evidence of a live experiment.

## 3. Live Jev analysis of the recorded healthcare trace

Select a completed live healthcare run in the dashboard. Configure the codebook through the normal forms, select the Jev model (the agreed default is pinned `jev-1.14.0`, subject to current availability), and preview the actual trace selection/windowing. Start with the configured defaults of 12 steps per window and stride 4 where they fit.

Launch on demand. Verify that the analysis worker loads the recorded evidence from MongoDB and calls the real TypeSafe/Jev service. This must analyze the healthcare run, not an unrelated synthetic provider-test payload.

Pass evidence:

- Preview and launch agree on run/source identity, codebook revision, selected evidence, window size and stride.
- A real provider attempt records requested/returned model identity and usage where supplied. Status moves through the real job lifecycle; a queued job alone is not success.
- Scores for the configured tags appear in the analysis view, including the chart/window list and links back to the relevant source steps/evidence. Treat scores as tentative classifier outputs, not calibrated human certainty.
- At least one complete, nonempty analysis succeeds. Oversized windows, provider errors and unscored windows are visibly distinct from negative/zero classifications; they cannot be counted as successfully scored coverage.
- Adjust chunking settings and rerun on demand. The rerun has its own frozen settings/results and does not overwrite the first analysis.
- Results and provider-attempt evidence survive refresh and export.

If a default window is too large, keep it flagged and explicitly select smaller settings for a separate analysis. Do not silently truncate, split or shrink fixed windows. Ensure there is enough actual recorded content to demonstrate overlapping windows; record insufficient source length as an unexercised case.

## 4. Independent live oversight evaluation

Use the Oversight UI to select the same completed live run, freeze questions/outcome definitions, choose a separately selectable live monitor model, and preview all four evidence views. Adaption can serve this monitor through the analysis worker's independent transport.

Launch on demand and verify:

- Real monitor requests occur for reports-only, audit, audit-plus-board and full-trace views, using the same frozen monitor configuration across the comparison.
- Each request contains only its permitted projection. No Jev predictions, evaluator truth, researcher utility results, human review labels or other monitor answers are added to its input.
- Private memory and available provider reasoning appear only where the view permits them; unavailable reasoning is recorded as unavailable.
- Outcomes return present/absent/uncertain with supporting evidence IDs and explanations. Citations resolve to evidence available in the corresponding view.
- All four views complete successfully before the comparison is called complete. Oversized, invalid, failed or missing views remain explicit; they are not converted into absent findings.
- Judgments, frozen definitions/settings, exact evidence projections and provider metadata persist and export correctly.

Use the existing direct-view evaluation design. Do not add chunk-assessment/final-synthesis stages or feed full-trace Jev output to narrower oversight views. A monitor disagreement or uncertain verdict is a valid observation, not a smoke-test failure.

## 5. Researcher UI continuity

Check that selecting a Jev window, monitor citation, board delivery or artifact version opens the expected evidence in the same run. Save a human review and verify its sampling source and assisted/blind mode are represented correctly. Human decisions remain separate from machine suggestions; a final adjudicated outcome still requires two reviewers to agree.

Reload/reopen the run and research jobs, then export them. Verify that the exported run/source IDs, codebook revision, analysis settings and monitor definitions match the UI. If using the team's tunnel URL, confirm navigation and API calls there; a local HTTP 200 does not prove the tunnel works.

## 6. Existing commands and their limits

| Command | What it establishes | What it does not establish |
| --- | --- | --- |
| `npm run smoke:healthcare -- --keep` | Scripted healthcare API/queue/Mongo path | Live Adaption, Jev or oversight calls |
| `npm run smoke:live --workspace=@sidechannel/experiment-worker -- adaption <model-id>` | One real provider/memory/trace probe | Full healthcare execution or dashboard launch |
| `npm run smoke:jev --workspace=@sidechannel/integration` | One live Jev classification over a scripted fragment fixture | Jev over the live healthcare trace or dashboard analysis launch |
| `npm run smoke:dashboard --workspace=@sidechannel/integration` | Illustrative in-memory UI workspace | Production MongoDB, real inference, real analysis or persisted research results |

These commands can help isolate faults but do not replace the live dashboard path. Do not present illustrative dashboard data as a live result. The standalone Jev smoke uses an isolated database and removes it afterward; the application walkthrough should retain its real run/job evidence.

## 7. Record the result

Keep per-stage status as **pending**, **passed**, **failed** or **not exercised**, with exact run/job/evaluation IDs and a short reason. Record provider model IDs, definition revisions, budget settings, build revision, timestamps, usage when supplied and export locations. Do not record secrets.

| Stage | Initial status | Required evidence |
| --- | --- | --- |
| Live Adaption healthcare pair | Pending | Both real run IDs, recorded provider responses and terminal outcomes |
| Live Jev healthcare analysis and settings rerun | Pending | Both analysis job IDs, frozen settings, successful provider results and evidence links |
| Live independent oversight | Pending | Evaluation ID, four successful views and validated citations |
| Persistence and UI continuity | Pending | Reloaded evidence/results, saved review and matching exports |
| Team tunnel access, if used | Pending | Verified application/API access through the actual team hostname |

No live result is asserted by creating this checklist. Overall success requires the applicable live stages above; mock/scripted checks remain separately labelled supporting evidence. Record task utility and model behavior separately from service integration success.

## Related documents

- [Healthcare implementation requirements](archive/2026-11-07-healthcare-dashboard-smoke-readiness.md)
- [Recorded scripted readiness results](archive/2026-11-07-healthcare-smoke-results.md)
- [Dashboard operations](dashboard-operations.md)
- [Jev analysis specification](jev-analysis-spec.md)
- [Harness operations](harness-operations.md)
