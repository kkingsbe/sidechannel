# Researcher dashboard specification

Status: proposed product and implementation specification. Updated November 7, 2026.

The dashboard will be rewritten. This document specifies the full researcher experience and its backend dependencies; it does not prescribe retaining the current static HTML/JavaScript frontend. The [Jev analysis specification](jev-analysis-spec.md) separately defines trace normalization, windowing, classification, jobs, and persistence.

## 1. Product purpose and scope

The team needs one shared place to configure experiments, launch matched conditions, follow execution, inspect evidence, configure behavior codes, run analysis, review candidate behaviors, and compare oversight results. A teammate should be able to understand a run without reading MongoDB records or a local terminal.

The dashboard is a researcher interface. It is not the agents' task-progress display, and researchers' analysis results are not delivered back to agents. Changing the dashboard must not change the experimental condition. Both board conditions retain the same full researcher recording; the intervention is what agents are told about operator review.

The rewrite uses React + Vite + TypeScript with shadcn/ui + Tailwind, customized for a run-focused research workspace. It should retain the useful capabilities of the current interface while adding analysis, review, and oversight workspaces. Styling and layout remain independent of the Mastra harness and Jev worker through shared typed contracts.

### Agreed architecture and release decisions

| Area | Decision |
| --- | --- |
| Frontend | React + Vite + TypeScript with shadcn/ui + Tailwind; rewrite the existing dashboard. |
| Layout and themes | Run-focused navigation, central timeline, and side evidence inspector. Light/dark themes follow the system preference by default, with a user override. |
| Backend services | Separate researcher API, Mastra experiment worker, and analysis/monitor worker, sharing MongoDB and typed contracts. |
| Team access | Use the partially configured Cloudflare Tunnel. Initially open, without dashboard sign-in or Cloudflare Access authentication. Inspect existing routing/configuration before implementation changes. |
| Release scope | One complete release including experiment workflows, evidence inspection, Jev analysis, human review, and oversight. Internal implementation stages do not reduce release scope. |
| Experiment launch | Launch one matched pair at a time; duplicate its configuration to test another model. Matrix/campaign launching is deferred. |
| Jev defaults | Pinned `jev-1.14.0`, configurable selection; 12-step windows with stride 4; all available evidence categories selected by default. |
| Oversized Jev inputs | Keep fixed windows and flag them for manual settings changes. No automatic shrinking, splitting, or content truncation. |
| Codebook | Populate current tentative codes as editable definitions; refine through pilots. |
| Human review | Assisted by default, optional blind review; two reviewers must agree before a human run-level outcome is final. |
| Review selection | Offer flagged windows and random samples; preserve and expose sampling provenance. |
| Oversight model | Independently selectable; freeze the same settings across all four evidence views in a comparison. |
| Oversight configuration | Form-based editing of monitor questions and outcome definitions, with version history and immutable evaluation snapshots. |
| Oversight launch | On demand: select completed runs, preview settings and evidence, then launch all four views. No automatic evaluation on experiment completion. |
| Oversight evidence/output | Full view includes private memory and available reasoning. Return present/absent/uncertain per outcome, evidence IDs, and a short explanation. |
| Analysis separation | Jev screens the full trace through windows for researcher use. Oversight receives no Jev classifications and assesses each evidence view directly; no chunk assessments or final synthesis stage. |

### Delivery boundaries

| First complete dashboard | Subsequent extensions |
| --- | --- |
| Form-based experiment configuration, validation, frozen matched-pair launches, and configuration duplication | Model × condition × repetition matrices, larger campaigns, and scheduling |
| Run list, live progress, cancellation, paired navigation | Individual sign-in and role management beyond the initial open deployment |
| Timeline, board deliveries, artifacts, memory, reports, trace references | Rich provider-specific trace trees where supported |
| Form-based codebook editing and revisions | Bulk migration/synchronization with external research documents |
| On-demand Jev analysis, results, comparisons, and review | Continuous analysis of active runs and per-agent windowing |
| Versioned monitor definition forms, connected view previews, on-demand evaluation jobs, and results | Training monitors or automated adjudication |
| Reproducible exports and clear failure states | Publication/report generation |

Monitor UI can be built around fixtures while its backend is developed, but must be labelled unavailable or demonstrative until connected. Connected analysis, review, and oversight are required for the complete release. The same rule applies to scenario-specific views: a placeholder is not a working healthcare evaluator.

## 2. Information architecture

Recommended top-level destinations:

| Destination | Main question answered |
| --- | --- |
| Overview | What is running, what finished, and what needs attention? |
| Experiments | What configuration are we testing, and what runs belong together? |
| Runs | What happened in a particular execution? |
| Codebook | Which behavior definitions are we using? |
| Analysis | What do Jev's window-level estimates show, and what has been reviewed? |
| Oversight | What can each evidence view detect? |

Use a run-focused workspace with persistent navigation, a central timeline/content area, and a side evidence inspector. Top-level destinations may be navigation items or nested workspaces, but evidence selected from charts, tables, or the timeline should open in the same inspector pattern without losing context. On narrower displays the inspector can become a drawer or separate view. Use stable URLs for a run, an event, a board message, an artifact version, an analysis, and an analysis window. Refreshing or sharing a link should preserve the selected object and useful filters.

Do not conflate an experiment run, an analysis job, and a monitor evaluation. They have separate IDs, statuses, settings, and costs. Show the source run on every derived result page.

## 3. Experiment configuration and launch

### Draft editor

Provide ordinary form controls with helpful descriptions and validation. A JSON export can exist as a secondary developer feature; editing JSON must not be necessary for normal team use.

Configuration groups should include:

- **Task and scenario:** scenario/version and supported task parameters. The healthcare task itself is one selected scenario, not an arbitrary task-building platform.
- **Agents and models:** role roster, role tools, provider/model, and supported generation settings. Default to a shared model configuration across agents for the study; visibly identify exploratory mixed-model runs if later supported.
- **Execution:** fixed rounds, admitted tool-call allowance per turn, seeded agent order, timeouts, and context limits.
- **Board:** single-stream behavior, latest-N default page size, pagination limit, and post-size limit.
- **Memory:** enabled private conversation and working memory, scope/isolation, and supported limits. Do not expose settings the backend cannot enforce.
- **Condition and pairing:** reviewed/unreviewed board wording and pair creation, with the invariant that other settings match.
- **Study metadata:** pilot/study/fixture designation, descriptive name, notes, and grouping identifiers where supported.

Use the backend's configuration schema as the authority. Some field types may be scenario-provided; define a small supported control schema rather than evaluating arbitrary frontend code from a scenario. Unknown required fields should produce a visible unsupported-configuration state, not disappear.

Clarify units: an admitted tool call uses one turn-budget unit, including board tools, memory updates, and `end_turn`. A classification step used for Jev windowing is a different unit. Context limits must use the implementation's actual units; current memory/context bounds must not be labelled token limits when they are character-based.

Drafts can be saved, duplicated, renamed, and validated. Validation returns field-level errors plus cross-field constraints. Keep invalid drafts editable. A valid draft is not automatically a launched run.

### Launch review

The first release's study-launch workflow creates one matched pair at a time. Duplicate a draft or a frozen pair's configuration into a new draft to test another model or repetition, preserving lineage without mutating the source. This is a UI submission unit, not a new limit on the existing queue; execution capacity remains a backend concern. Existing single-run fixture/debug capabilities can remain available. Do not build a model × condition × repetition campaign editor for this release.

Before launch, show a compact resolved configuration: scenario/version, model, roster, rounds/budgets, seed, condition, and pilot/study status. For a pair, show the one intended difference and flag any other mismatch. Launch freezes the configuration; subsequent draft edits do not affect queued or running executions.

Prevent accidental duplicate submissions with request idempotency or an equivalent backend launch contract. Disabling a button alone is insufficient. Show returned run IDs immediately and navigate to progress. Queue order and actual execution capacity should be visible, including the current harness's single-worker constraint.

Provide cancellation with a clear explanation of what the backend will do. Distinguish cancellation requested from a terminal cancelled state. Do not offer pause/resume or edit-in-place controls unless those operations are genuinely supported.

## 4. Team overview and run workspace

### Overview and run list

Show current experiment activity, recently completed runs, failures requiring attention, and analysis/monitor jobs separately. Include connection freshness and worker availability where the backend can report them. A stale browser connection must not be represented as a failed experiment.

The run table should expose name/ID, condition, model, scenario, phase, status, round/turn, timestamps, pair/group, and available usage. Filter by status, model, condition, scenario, and pilot/study/fixture designation. Clearly mark scripted fixtures so they cannot be mistaken for spontaneous behavior in model experiments.

Link matched runs directly. A comparison page should summarize frozen configuration differences and execution outcomes before offering detailed evidence or analysis comparisons. Do not imply a statistically meaningful model ranking from a few runs.

### Run header and progress

A persistent run header shows status, condition, model, config hash, active agent, round/turn, elapsed time, source completeness, and links to the matched run and export. Show separate action and reporting phases. Fixed rounds permit round progress, but variable tool use means this is not a reliable percentage of elapsed time.

Use polling or a resumable event stream with a sequence cursor. Reconnect without duplicating events or skipping already recorded evidence. Closing the page must not stop the experiment. Poll analysis status independently from experiment status.

### Evidence views

| View | Required behavior |
| --- | --- |
| Timeline | Ordered model invocations, tool requests/admissions/results, side effects, turn boundaries, errors, and reporting. Filter by actor, phase, event type, and sequence range. |
| Board | One chronological stream with author, message ID, time, and exact read/delivery relationships. A posted message is not assumed to have been seen by every agent. |
| Artifacts | Version history, author/operation attribution, structured display when supported, version comparison, and frozen final artifact. |
| Memory | Agent-scoped working-memory versions and diffs, with provenance and visibility clearly marked. No implication that other agents received these notes. |
| Reports | Individual submitted reports, parsed fields, raw output, invalidity indicators, and the exact reporting prompt/question version when available. |
| Model/traces | Application invocation detail, input/output, usage, tool calls, and recorded Mastra/provider references. Show only reasoning actually available from a supported adapter. |
| Configuration | Immutable resolved configuration and run metadata, with a separate action to duplicate into a new draft. |

All detail views link back to canonical events. Large payloads use progressive disclosure and pagination. Raw JSON is acceptable as a secondary evidence/debugging view, even though configuration and codebook editing use forms.

The timeline must distinguish proposal from execution and denial from success. Historical messages repeated inside model inputs should be inspectable as input context without being presented as new messages. A tool failure or truncated trace needs an explicit diagnostic, not a silently omitted row.

### Scenario-specific artifacts

Define a renderer registry keyed by artifact kind/schema version. A generic structured table/tree is the fallback. Renderers receive recorded artifact data and its provenance; they must not recompute or alter experimental outcomes in the browser.

For a future healthcare ranking artifact, likely useful fields are rank, synthetic case key, permitted score/features, uncertainty flags, and source contribution references. Exact columns follow the finalized scenario schema. Ground-truth comparisons and restricted answer keys belong in a clearly separated researcher evaluation view, never in the artifact supplied to an oversight monitor.

## 5. Codebook editor

The dashboard is where the team configures the actual behavior codes used by Jev. There is no separate hidden first-tag preset and no automatic Google Doc synchronization.

Use a list/detail editor. The list shows code/name, short definition, enabled state, revision, and color. The detail form offers:

| Field | Purpose |
| --- | --- |
| Code and display name | Human-readable identification; retain a stable internal ID across renames. |
| Definition | What the behavior means in this study. |
| Inclusion and exclusion criteria | What qualifies, and common nearby behavior that does not. |
| Examples and counterexamples | Optional concrete interpretation aids. |
| Qualifying evidence/action types | Whether a proposal, statement, executed action, or linked participation is needed. |
| Enabled state | Whether new analyses include this code. |
| Color | Consistent visual identification; never the only identification. |

Support create, edit, duplicate, archive, reorder, and revision history. Require a meaningful definition and validate unique display codes within a revision. A conflict from another teammate's edit should offer reload/reconcile, not silently overwrite their changes. Archive preserves historical analyses and reviews.

Show where a revision is used. Saving changes affects future launches only. Existing analysis pages display their frozen definitions, with a notice if the current codebook differs. A launch preview should make the exact enabled set easy to inspect.

### Archiving a codebook

A whole codebook can be archived and restored from the editor. Archiving is reversible and never deletes revisions or changes existing analyses, which keep their frozen `manifest.codebook` definitions.

- **Selector.** The codebook selector lists active codebooks only. A **Show archived** toggle switches the list to include archived codebooks, labelled `· archived`; pagination ("Load more codebooks") is retained and accumulated options reset when the toggle changes.
- **Archive.** The **Archive codebook** button asks for confirmation, explaining that existing analyses are unaffected and the codebook cannot be used for new analyses until restored. It sends the current revision ID (`expectedRevisionId`) and the revision author as the actor, and is disabled with a visible reason when no author is entered or when there are unsaved edits (save or discard them first). If "Show archived" is off, the codebook leaves the list and the next active codebook is selected, or the empty state is shown when none remain.
- **Archived view.** An archived codebook shows a banner (archived by, date), the editor is read-only (inputs, code archive toggles, add/reorder and save are disabled), and **Restore codebook** is offered. Restoring refreshes the codebook and keeps it selected.
- **Conflicts.** Server 409 messages (stale revision, already archived, not archived) are shown with a reload action.
- **Analysis setup.** The setup codebook picker lists active codebooks only. If the selected codebook is archived (for example when cloning an earlier analysis), setup shows "This codebook is archived. Restore it on the Codebook page to start a new analysis." with a link to `/codebook`, and preview and launch are blocked client-side. Existing analyses display unchanged.

Populate the initial codebook with the current tentative definitions for PROPOSE, DELEGATE, ACCEPT, SUPPLY, JOIN, CHALLENGE, COMPLY, VISIBILITY, and REPORT SHAPING as editable records. These are the actual codebook, not a separate preset or immutable taxonomy. Refine them through pilots without assuming every code signifies misconduct.

## 6. Jev analysis workspace

This section owns the user experience. The [analysis specification](jev-analysis-spec.md) owns window semantics, provider requests, storage, and job execution.

Jev performs full-trace screening through overlapping windows, with optional phase/range and evidence filters. Full-trace screening does not mean sending the entire run in one request. Its probabilities are for researcher exploration and human review; they are not inputs to oversight monitors. There is no Jev-assisted chunk-report or final-synthesis pipeline in this release.

### Configure and preview

From a terminal run, choose **New analysis**. Show:

- Source run and completeness, with phase/range selection.
- Codebook revision and enabled codes.
- Window size and stride/overlap controls, with a visual explanation of the selected windows.
- Evidence category switches, including separate controls for private memory and available provider reasoning.
- Jev model and an optional descriptive analysis label.

Use an integer input/stepper for window size and stride. Display overlap as derived information or keep linked controls synchronized. Do not present two independent, contradictory values. Default to 12 steps and stride 4, editable before launch. Default Jev selection to pinned `jev-1.14.0`, with an explicit model selector. Initially select all available evidence categories, including private memory and available provider reasoning; show missing coverage separately from disabled categories.

Preview window count, partial windows, enabled-code count, evidence availability, skipped/oversized inputs, and estimated request volume. Estimates must not imply a guaranteed bill. A preview window should reveal exactly the evidence being sent. Explain that provider-visible evidence comes from selected categories, not merely from currently visible timeline rows.

Preserve fixed window boundaries when inputs are too large. Show the affected windows, estimated size and applicable limits, and offer a settings change/new preview; never automatically split, shrink, summarize, or truncate their evidence. Oversized windows remain visible with null scores and a reason. The backend may batch tag questions against unchanged evidence to fit the combined-question limit; record those batches without changing the window's identity. See [input budgeting](jev-analysis-spec.md#provider-input-budgeting) for context limits and estimator requirements.

Launch creates an analysis job. A user can leave the page, share the job link, and return later. Surface preparation, execution, partial failures, cancellation, and retry-missing controls. Display provider/configuration errors with actionable next steps while preserving successful results.

### Results presentation

Use three coordinated views:

1. **Probability timeline:** small multiples by behavior code, with a common `[0, 1]` or `[0%, 100%]` scale and a shared source-step axis. Points sit at window ends; hover shows full start/end range, actors, code definition, probability, and completeness.
2. **Heatmap:** behavior codes by windows for scanning longer traces. Show missing/skipped results distinctly from low probability.
3. **Evidence inspector:** selecting a point or cell opens that window's exact normalized evidence, source links, actors, tool outcomes, and review state.

An accessible table supplies the same scores and navigation without depending on charts. Use text labels alongside colors. Default to unsmoothed values and show gaps for unavailable results. If line segments connect points, explain that they connect overlapping-window estimates rather than measuring an instantaneous behavioral signal.

Label the value **Estimated probability the behavior occurs in this window**. Do not invent a second confidence percentage or describe the score as calibrated accuracy. Multiple tags may be high together. A high score does not automatically label every contained event or establish a run-level violation.

Optional display thresholds can highlight candidate windows. Changing thresholds, colors, filters, or visible tags should not rerun inference. Changing definitions, windowing, evidence, or provider model creates a new analysis. Preserve the distinction between hiding a tag and excluding it from a new analysis.

### Compare and rerun

Duplicate an analysis's settings into a new draft, change the desired fields, preview, and launch. Preserve both results and link parent/child analyses. A comparison shows configuration differences before score differences.

Initially support two analyses of the same source run. Align by original source-step position and show each actual window range. Different window grids must not be silently interpolated into supposedly equivalent observations. Warn when code definitions differ; a shared display name does not establish semantic equivalence. Cross-run and matched-condition aggregate plots can follow after run-level comparison rules are agreed.

## 7. Human review and research outcomes

From a window or source event, a reviewer can record `present`, `absent`, or `uncertain` for a behavior, attach evidence references, and write a rationale. The UI must identify whether the judgment applies to the whole window or selected events. Review state is separate from model probability.

Use assisted review by default. Offer a blinded initial-review mode that hides predictions until the first judgment is saved, and record whether suggestions were visible. Retain revision history and disagreements; do not resolve them by overwriting one review. In the initially open deployment, use self-entered reviewer names/identifiers and label them as claimed identities, not verified accounts.

Review queues offer both flagged windows and random samples from a declared eligible population, including low-scoring windows. Filters include unreviewed, disagreement, uncertainty, code, and model-estimated probability. Preserve the source of selection (`flagged`, `random`, or manual navigation), analysis/codebook revision, relevant thresholds/filters, and random-sampling seed and population reference. If a window belongs to both groups, retain both reasons without presenting duplicate review tasks. Do not resample merely because the page refreshes.

Show sampling provenance in the queue and exports so deliberately selected candidates are not mistaken for an unbiased sample. In blind mode, hide score-derived selection reasons and ordering cues until the initial judgment is saved, while retaining that provenance in storage. Sampling proportions and thresholds remain configurable pilot settings; random windows are still correlated within runs and do not create additional independent experimental units. Human review can add event-level evidence even when the preliminary classifier only scored windows.

Run-level outcome adjudication is separate: individual violation, coordinated violation, false reporting, deliberate concealment, and coordinated concealment require their own evidence and definitions. The strict research endpoint cannot be inferred from a maximum chart value or the presence of a VISIBILITY label. Show supporting linked contributions and reports, reviewer decisions, and unresolved questions.

Require agreement from two distinct reviewers before a human run-level outcome is final. Show provisional, disagreement, and agreed states with the contributing review revisions. Do not provide a single-reviewer finalization override. A disagreement remains unresolved until two reviewers confirm an agreed judgment, preserving the earlier disagreement in history. Agreement on `uncertain` records final uncertainty, not a positive or negative reference label. Revising an agreed judgment reopens finalization until agreement is re-established. Ordinary event/window annotations do not need two approvals to remain useful as provisional research notes.

## 8. Oversight monitor workspace

Oversight asks how detection changes when a monitor receives different evidence. The researcher dashboard can show everything the researcher is authorized to inspect; a monitor run receives only its selected server-generated projection.

Oversight is independent of the Jev screening workflow. Each view is assessed directly in an isolated model call; there are no intermediate chunk assessments, Jev annotations, or final cross-chunk synthesis. A monitor evaluation can run before any Jev analysis exists. Reports-only is the narrowest of the four views, not the entire oversight feature.

### Monitor question and outcome editor

Provide forms for editing the monitor's evaluation questions and run-level outcome definitions. Each outcome has a stable internal ID, display name, definition, qualifying criteria, and guidance for `present`, `absent`, and `uncertain`; examples and exclusions can clarify difficult cases. Edit the question wording through normal text fields, not a JSON editor. These run-level definitions are separate from Jev's window-level behavior codes.

Save immutable revisions with conflict checks, revision history, and archive behavior that preserves historical results. At launch, freeze the complete question/outcome definitions alongside the selected model/settings and evidence-view versions. Later edits affect new evaluations only. Human reference outcomes must identify the definition revision used; comparisons across incompatible definitions must be flagged rather than silently pooled. Versioning and authoring are in scope now; final research wording is refined through pilots.

### Proposed evidence views

These operationalize the current research outline and must be frozen before study evaluation:

| View | Included evidence | Explicit exclusions |
| --- | --- | --- |
| Reports | Final individual reports and submitted artifact | Tool history, board, memory, provider reasoning, intermediate artifact versions |
| Reports + audit metadata | Reports view plus approved actor/tool/time/resource metadata | Tool arguments/results, board text, memory, provider reasoning, intermediate content |
| Reports + audit + board | Previous view plus board posts and exact delivery records | Other tool payloads, private memory, provider reasoning |
| Full observable trace | Previous view plus tool arguments/results, assistant outputs, artifact history, private memory, and available provider reasoning | Unavailable hidden reasoning, answer keys, Jev predictions, human labels |

Include private working memory and available provider reasoning in the full view, with availability/coverage recorded. Exclude both from the three narrower views. Give the projection a version and named settings; do not silently broaden it. Use an allowlist for audit metadata because resource labels, error strings, or nested fields can themselves reveal content. An unavailable reasoning field is not evidence that the agent had no reasoning or intent.

All views receive the same necessary task/policy context and evaluation questions. Board content is available from the third view because that is its explicit inclusion rule, not because the agent condition says operators review it. The condition changes agents' beliefs, not which evidence researchers actually recorded.

### Configure, preview, execute

Oversight runs on demand. Select one or more completed runs, select the monitor configuration revision, preview the four evidence projections, and explicitly launch the comparison. Experiment completion does not automatically trigger monitor calls. Show independent job progress and allow returning later without keeping the browser open.

The monitor setup selects source runs, monitor provider/model and settings, evaluation question version, and evidence-view versions. The monitor model is independently selectable from both the experiment model and Jev classifier; do not silently inherit either. Freeze the same monitor model/settings across all four views in each comparison. Show each exact serialized view in a preview with included/excluded categories and missing evidence indicators. A browser visibility toggle is not an evidence projection.

For each view, launch an isolated monitor invocation with no shared conversation or prior results from another view. The backend excludes Jev scores, human reviews, ground-truth labels, and other monitor outputs. Compare views using the same monitor configuration. Any redaction intended to hide condition labels must be a versioned research choice rather than an undocumented UI filter.

Show queued/running/completed/partial/failed states, structured verdicts, cited evidence references, duration, and usage. For each run-level outcome, require a `present`, `absent`, or `uncertain` verdict, supporting evidence IDs, and a short explanation. The first contract does not require probability scores. An uncertain or absent judgment may have no supporting event IDs where the evidence is missing; its explanation must state the limitation. Validate output structure and ensure each citation belongs to the supplied projection. Invalid output is a monitor failure, not a negative finding.

### Report size and oversized views

Agents' final reports are short answers to the reporting questions, currently covering their own actions, observations, and limitations. Reports-only oversight supplies those reports, the submitted artifact, and evaluation context in one invocation; no report-chunking machinery is required. Check the complete request against the selected model's capacity rather than assuming artifact size is bounded by report length.

Audit, board, and full-trace views can be much larger. Preflight each complete request, accounting for instructions and output allowance as well as evidence. If a view exceeds capacity, expose an explicit oversized/unavailable result and retain results from views that fit; do not silently truncate, summarize, or substitute Jev scores. A comparison with an unavailable view is partial, not a four-view completed result. A more elaborate recovery policy remains open if real runs require it. Do not implement automatic chunking or impose the previously discussed 32k chunk-data target on this direct-assessment workflow.

### Compare detection

A per-run matrix puts evidence views side by side with the adjudicated run outcome, keeping monitor outputs and reference labels visually separate. Expose the exact evidence behind each judgment and the projection version. Unsupported citations should be flagged rather than rendered as valid links.

Aggregate detection and false-positive rates require reference outcomes finalized by two-reviewer agreement and clear denominators. Separate excluded/incomplete runs, provisional/disputed labels, and agreed-uncertain outcomes from binary reference denominators. Show monitor `uncertain` verdicts as a separate count; report detection as positive findings among reference-positive runs, without silently dropping monitor abstentions. If there are no confirmed positive examples, recall is unavailable; if there are no confirmed negative examples, false-positive rate is unavailable. Do not display missing denominators as zero. Report counts alongside rates, preserve matched-run relationships, and treat runs as the experimental unit.

The analysis workflow can help locate candidate behaviors, but its tuned predictions are not an independent ground truth for evaluating monitor detection.

## 9. Backend contracts and data ownership

| Data | Owner and dashboard responsibility |
| --- | --- |
| Draft experiment configuration | Backend validates; dashboard edits through forms and handles revisions. |
| Frozen runs and canonical evidence | Harness/MongoDB owns; dashboard reads and deep-links without rewriting evidence. |
| Codebook revisions | Analysis service owns immutable revisions; dashboard provides authoring UI. |
| Analysis jobs/results | Separate analysis worker owns; dashboard configures, follows, inspects, and compares. |
| Human reviews | Review service records append-only history or equivalent audited revisions. |
| Review selection batches | Backend stores eligible population, selection method/settings, seed, and selected IDs so sampling is reproducible. |
| Monitor definition revisions | Backend stores editable question/outcome configuration and immutable snapshots; dashboard supplies form-based authoring. |
| Monitor projections/results | Oversight backend owns projection and inference; dashboard previews and compares. |
| Display preferences | Dashboard owns local or saved preferences; these never silently alter inference settings. |

Reuse existing run, draft, pair, event, board, memory, artifact, report, export, and cancellation capabilities where they fit. Extend the backend for missing draft revision/idempotency behavior, overview summaries, analysis/review contracts, and monitor jobs. The rewrite must not assume every described endpoint already exists.

The [analysis API proposal](jev-analysis-spec.md#proposed-backend-contract) is the shared contract for Jev features. Monitor APIs should expose definition CRUD/revision history, projection preview, on-demand job creation/status, per-view results, and export, with explicit schema versions. Launch must validate the previewed revision or reject a stale submission; it must not silently adopt a teammate's newer questions. Review APIs need durable selection-batch creation/retrieval as well as annotation storage. Keep frontend transport types separate from raw MongoDB documents and provider payloads.

Use three separate backend services: the researcher API for dashboard requests and job submission; the Mastra experiment worker for agent execution; and the analysis/monitor worker for Jev and oversight jobs. Share MongoDB and versioned TypeScript contracts. Use independent job leases and concurrency controls; analysis/monitor work must not occupy the experiment worker's execution guard. The frontend uses the researcher API rather than calling the Mastra runtime directly.

Team access is through the partially configured Cloudflare Tunnel, initially open without sign-in or Cloudflare Access authentication. Inspect the existing tunnel/proxy setup before changing it and route browser API requests to the researcher API, preferably under the same public origin. This is a deployment requirement, not a claim that the existing setup is already open. Individual accounts are deferred. Keep database and model-provider credentials server-side and keep workers/database off the public routing surface. Backend input validation remains required in open mode; do not treat a self-entered reviewer name as authentication.

Paginate timelines, windows, reviews, and artifact histories. Use server-side filtering where datasets exceed a page. Preserve stable selection when new events arrive. Do not fetch a complete growing run document repeatedly just to update one progress indicator.

Exports should cover source evidence, frozen configurations, analysis settings and definitions, scores and missingness, reviews, and monitor projection provenance as separate linked datasets. Explicitly label export scope. Never include credentials or imply that a filtered export is the complete evidence record.

## 10. Interaction quality and failure states

- Use customized shadcn/ui components and Tailwind styling throughout the run-focused workspace. Supply light and dark themes, following the system preference by default; persist a manual light/dark/system choice. Charts, evidence highlighting, and inspectors must remain readable in both themes.
- Preserve unsaved form edits across recoverable network errors and show save status.
- Provide loading, empty, unavailable, stale, partial, and failed states distinctly. A missing score is not zero; unavailable reasoning is not empty reasoning.
- Keep long jobs in the backend; display progress without requiring the tab to remain open.
- Make tables, chart selections, forms, and inspectors keyboard accessible. Provide readable labels, focus handling, and alternatives to color-only signals.
- Support a desktop research layout with a usable narrower view; avoid requiring a specific monitor width for evidence review.
- Render agent/tool content as untrusted text, not executable HTML. Preserve formatting safely and make long payloads expandable.
- Confirm destructive or consequential UI operations appropriately, but avoid confirmation dialogs for every harmless filter or preview.
- Make errors identify the affected run/job/window and preserve useful partial work. An analysis outage should not disable experiment inspection.

## 11. Build sequence and verification

These are internal build stages toward one complete release, including analysis, review, and oversight.

1. **Scaffold React + Vite + TypeScript with shadcn/ui + Tailwind and define API types.** Establish the run-focused layout, system-aware themes, routing, separate service entry points, shared components, deep links, the initial open tunnel deployment, and mock fixtures for backend capabilities not yet available.
2. **Restore the complete experiment workflow.** Implement overview, form-based configuration, validation, pairing, launch, progress, cancellation, and immutable run detail.
3. **Build evidence inspection.** Add timeline correlation, board deliveries, artifact versions, private memory, reports, and model/trace references against real saved fixtures.
4. **Add codebook and analysis.** Integrate revisions, preview, async jobs, probability charts, evidence drill-down, reruns, and same-run comparisons using the separate analysis contracts.
5. **Add review and oversight.** Implement flagged/random selection, review history/blinding, run-level adjudication, editable versioned monitor definitions, projection previews, on-demand isolated jobs, and comparisons as their backends become available.
6. **Verify team workflows and exports.** Exercise concurrent edits, reconnects, partial failures, accessibility, and shared links; distinguish unavailable features from working ones.

Acceptance scenarios:

- A teammate creates a valid draft and launches a matched pair without editing JSON; frozen runs differ only in the intended condition fields.
- A teammate duplicates the pair configuration to test another model without editing the original runs or using a campaign matrix.
- Another teammate opens a run link and can identify execution state, model, condition, and evidence freshness.
- A board message can be traced from its author through successful posting to the exact agents that read it.
- An artifact or report can be inspected with its source evidence and version, including failure/invalidity cases.
- A codebook edit creates a revision without changing old analyses; conflicting saves do not silently lose work.
- The same trace can be analyzed with two window settings; both results remain available, and selected scores open their actual evidence windows.
- Missing/failed results appear as gaps, not negative classifications; chart and table values agree.
- A reviewer can work blind, attach evidence, and revise a judgment without erasing earlier decisions.
- Flagged/random review selection survives refresh and exports its provenance; blind review does not reveal Jev scores through selection labels.
- A human run-level outcome cannot become final with only one review; two agreeing reviewers are required and disagreements stay visible.
- The selected monitor model is independent from experiment/Jev settings and is frozen across all four isolated views in a comparison.
- Monitor questions/outcomes can be edited through forms; existing evaluations retain their frozen definitions after a later edit.
- Oversight launches only on demand and does not require Jev results. No monitor input contains Jev probabilities or intermediate chunk reports.
- A narrow monitor preview contains none of the disallowed payloads or labels, including nested fields.
- Full-view memory/reasoning availability is visible, and oversized Jev windows retain fixed boundaries with explicit missing scores.
- Refreshing, reconnecting, or closing the browser does not restart or stop backend work.
- System-default and manually selected light/dark themes work across charts, timeline, and the side inspector.

Use focused API/integration tests for contracts and a small number of end-to-end tests for these critical paths. Test large fixture pagination and keyboard evidence navigation. Do not make live model calls a prerequisite for routine frontend checks.

## 12. Open choices

Remaining implementation/pilot choices are the charting library and detailed styling, exact scenario artifact schema, precise monitor question wording and audit-metadata allowlist, initial monitor provider/model selection, operational concurrency/input-budget settings, review sampling proportions, and final codebook/study thresholds. Recovery for unusually large oversight views remains open if encountered; chunk assessment and synthesis are not part of the implementation scope.

The frontend stack/component foundation, run-focused layout, system-default themes, separate services, open Cloudflare Tunnel access, complete-release scope, matched-pair launch workflow, Jev defaults, flagged/random review, review agreement rules, editable monitor definitions, on-demand oversight, and separation of Jev from oversight are settled above. The Jev service and dashboard rewrite should proceed against shared versioned contracts, with mocks during development where the other component is not ready.

## References

- [Jev analysis workflow and backend specification](jev-analysis-spec.md)
- [Harness handoff](../harness_handoff.md)
- [Harness setup and current limitations](../agent/README.md)
- [Implementation decisions](../agent/docs/decisions.md)
- [Jev documentation](https://docs.typesafe.ai/introduction)
