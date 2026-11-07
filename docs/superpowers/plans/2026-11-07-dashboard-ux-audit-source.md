Sidechannel has a coherent visual foundation, but its main workflows still require too much knowledge of the underlying system. The most consequential problems are finding existing work, configuring experiments and analyses, and moving from source evidence to a defensible human judgment.

The redesign should make research work easier to understand and complete while preserving frozen configurations, exact evidence references, reproducible selections, and the separation between model estimates and human reference outcomes. Cosmetic changes alone will not resolve the friction.

**Audit date:** November 7, 2026. **Audience:** the Sidechannel product, design, and engineering team. **Status:** proposed improvements based on the current desktop dashboard review.

# Assessment and scope

The dashboard is usable by a researcher who already knows its concepts and implementation. It is much less forgiving for a collaborator joining the project. The design provides many controls and explanations, but does not consistently establish what to do next or distinguish routine choices from exceptional ones.

The strongest existing elements are consistent navigation styling, visible form labels, a stable experiment launch summary, explicit fixture labeling, recoverable experiment drafts, and inline experiment validation. These should remain part of the redesign.

The review covered Overview, Experiments, Runs, Codebook, Analysis, and Oversight in the seeded workspace at [localhost port 4311](http://localhost:4311/). Interactions included validating a configuration, entering an invalid round count, navigating away from and back to an unsaved draft, preparing an analysis preview, opening existing analysis results, inspecting a saved human-review batch, and opening a matched pair. The data was scripted; the preview did not call a model, and no new analysis or experiment was launched during the review.

Findings distinguish three evidence levels:

- **Observed:** visible behavior or layout encountered in the desktop walkthrough.

- **Source confirmed:** behavior corroborated by the current frontend implementation.

- **Validation needed:** a risk or proposed improvement that requires targeted testing before being reported as a defect.

This is a heuristic audit, not a measured usability study or accessibility certification. Mobile layouts, dark mode, assistive technology, long-running production jobs, large datasets, and multi-user conflicts remain validation work. The localhost links require the local workspace to be running.

# Users and research tasks

These working user profiles describe tasks the interface should support. They are design assumptions to validate with the team, rather than established research personas.

| User context | Primary task | What the interface must make clear |
| --- | --- | --- |
| Researcher preparing a study | Configure and validate a matched pair | What changes between conditions, what stays fixed, and which inputs are required |
| Researcher following execution | Find an active or completed run | Whether work is progressing, whether information is current, and where evidence lives |
| Analyst screening traces | Prepare and inspect an analysis | Which source and definitions were used, which windows can be scored, and what is missing |
| Human reviewer | Inspect evidence and record a judgment | The applicable definition, review mode, evidence scope, and saved status |
| Study lead comparing results | Compare conditions and oversight views | Which comparisons are complete and how estimates, judgments, and references differ |
| Returning collaborator | Resume unfinished work | Where drafts, pending reviews, and existing results can be found |

The core journey is: configure a study, launch matched runs, inspect evidence, screen selected evidence, review candidates, and compare outcomes. Users should be able to enter at any stage through a stable link and understand the surrounding context.

# Priorities

Priority describes the order of UX work, not a claim about security or research severity. **P1** addresses substantial friction or misleading readiness in a core workflow. **P2** improves navigation, comprehension, and repeat use. **P3** covers refinement after the core flow is sound.

| Finding | Priority | Evidence |
| --- | --- | --- |
| F01 Evidence review prioritizes raw structures over reading and judgment | P1 | Observed and source confirmed |
| F02 Navigation mixes collection pages with creation forms | P1 | Observed |
| F03 Experiment configuration exposes too many decisions upfront | P1 | Observed |
| F04 Disabled actions hide their unmet requirements | P1 | Observed and source confirmed |
| F05 An analysis with no scoreable windows still looks launchable | P1 | Observed and source confirmed |
| F06 Overview gives explanatory content space needed by operational data | P2 | Observed |
| F07 Names and labels make users decode internal concepts | P2 | Observed |
| F08 Pair comparison provides little comparative evidence | P2 | Observed |
| F09 Long research text is cramped into small editors | P2 | Observed |
| F10 Review queues reveal identifiers more readily than actionable context | P1 | Observed |
| F11 Breadcrumbs and view controls provide incomplete orientation | P2 | Observed and source confirmed |
| F12 Service and job status need a clearer operational model | P2 | Observed with follow-up testing needed |
| F13 The initial chart view makes cross-behavior scanning laborious | P2 | Observed |
| F14 Repeated guidance competes with task content | P3 | Observed |

Accessibility, responsive behavior, failure recovery, and scale are cross-cutting release checks. Their untested cases are listed separately rather than presented as confirmed defects.

# Detailed findings

## F01 Evidence review prioritizes raw structures over reading and judgment

**Observed:** selecting Review evidence opens a drawer whose initial content is dominated by expanded normalized JSON. Canonical source events are collapsed, and the judgment form follows the evidence sections. The form exposes a multiline field for linked event IDs.

**Source confirmed:** an Annotate this event action exists within the canonical event list and can prefill a single event reference. The problem is therefore not a total absence of assistance. The assistance is buried in a secondary representation, and selecting several supporting events for a whole-window judgment remains awkward.

The researcher must translate recorded structures into a narrative, locate the relevant identifiers, and carry those identifiers into the form. This increases effort and creates opportunities to attach the wrong evidence.

Make readable events the primary view: actor, phase, action, message or result, and sequence. Keep the behavior definition visible while judging. Place evidence and judgment side by side on sufficiently wide screens, with a clear stacked arrangement on narrower ones. Retain exact normalized input and raw payloads as expandable secondary views.

**Acceptance criteria**

- A reviewer can read the relevant recorded content and attach supporting events without copying an identifier.

- Selected citations show a readable label and resolve to the exact canonical event; removing one is explicit.

- A judgment can be completed while its definition and relevant evidence remain accessible.

- Switching to raw data preserves the selected scope and draft judgment.

- Missing source categories and incomplete windows remain distinguishable from empty content.

## F02 Navigation mixes collection pages with creation forms

**Observed:** Runs opens a collection, Experiments opens a new configuration form, and Analysis opens a new analysis form. Saved analyses become visible after selecting a source run and scrolling below the configuration. Oversight offers an Evaluation jobs view, but initially emphasizes configuration.

A returning user must remember where a record is hidden. The problem grows as the workspace accumulates runs and analyses.

Give each major destination a consistent entry pattern: existing work first, an explicit creation action, and contextual filters. Preserve direct links into creation and detail views. Use a global analyses list alongside per-run analysis history so users can work from either direction.

**Acceptance criteria**

- Existing drafts, runs, analyses, and evaluations are discoverable without completing a creation form.

- A new user can distinguish opening an existing record from creating one by the action label.

- Returning from a detail page restores the relevant list, filters, and selection.

- Existing record URLs continue to resolve after navigation changes.

## F03 Experiment configuration exposes too many decisions upfront

**Observed:** the experiment form presents metadata, scenario and dataset versions, seeds, model parameters, role instructions, tool permissions, execution limits, board settings, memory settings, and reporting schemas in one long page.

Several controls are legitimate expert settings, but they receive nearly the same prominence as the choices that define the experiment. A default-filled input also does not tell a user whether changing it is expected, supported, or unusual.

Organize setup into scenario and data, model and roles, execution, and review. Use advanced disclosures for optional sampling settings and technical configuration. Select supported scenarios and datasets through named choices where a registry exists, while retaining an explicit custom route when supported. Preserve values when sections collapse or steps change.

**Acceptance criteria**

- The initial setup view establishes the task, model, roles, and intended comparison before exposing every technical option.

- Advanced values remain inspectable and are included in the final frozen configuration.

- Validation can reveal and focus errors in a collapsed section.

- Changing a scenario identifies any dependent fields that will change before replacing user input.

- The launch summary explains the two conditions and the resources the selected settings imply, without inventing cost estimates.

## F04 Disabled actions hide their unmet requirements

**Observed:** after selecting a completed source run, Preview analysis remained disabled. Entering Researcher / creator enabled it. The requirement was not made clear beside the disabled button. Similar forms expose disabled save or create actions.

**Source confirmed:** analysis preview depends on source selection, codebook revision, nonempty creator, positive window size and stride, and selected evidence and phases.

An inactive button cannot be the only explanation of an invalid form. Users should not have to infer which of several fields is blocking progress.

Show required status consistently. For missing input, either permit an attempted submission that reveals actionable errors or show a concise requirements list beside the disabled action. Reserve unexplained disabling for neither case.

**Acceptance criteria**

- Every blocked primary action explains the missing prerequisite in visible text.

- A validation attempt links or moves focus to the first relevant field without losing data.

- Asynchronous work, invalid input, and lack of permission have distinct explanations.

- Requiredness, invalid state, and error descriptions are available programmatically as well as visually.

- The existing experiment inline error behavior remains intact.

## F05 An analysis with no scoreable windows still looks launchable

**Observed:** the default analysis settings on the inspected seeded run produced three oversized windows, all marked no score, and zero estimated requests. Launch analysis job remained available.

**Source confirmed:** once a preview exists, the launch control is disabled while a mutation is busy; it does not independently require a scoreable window.

Recording an all-skipped analysis may be a valid research operation. It should not resemble a normal scoring run.

Show an aggregate preflight result above the action: scoreable windows, oversized windows, partial windows, and estimated requests. When no windows can be scored, explain the outcome directly and offer links to relevant settings. If preserving an unscored record is supported, distinguish that action from launching inference.

**Acceptance criteria**

- Zero-score previews explicitly say that no scores will be produced.

- A partial preview states how many windows will be scored and how many will remain unscored.

- Changing settings invalidates the old preview and requires a new one.

- No automatic shrinking, truncation, or splitting is introduced to make the preview pass.

- Missing scores remain missing in results and exports; they never become zero probabilities.

## F06 Overview gives explanatory content space needed by operational data

**Observed:** at the inspected desktop width, Recent runs needed horizontal scrolling while an adjacent workflow guide occupied a substantial column. Large count cards and introductory content appeared before analysis and evaluation activity.

The layout makes sense as an introduction, but is less efficient as a returning researcher's work surface.

Give recent and active work the available width. Move the workflow guide to a collapsible onboarding area. Add actionable entries such as resume draft, inspect failed run, continue review, and open completed analysis when supported by reliable data.

**Acceptance criteria**

- Run name, condition, state, and the main open action are visible without horizontal scrolling at the agreed primary desktop viewport.

- Lower-priority metadata can collapse or move into record details before essential columns disappear.

- Counts link to the corresponding filtered records where a destination exists.

- Pending work has a clear action and accurately defined count.

- Introductory guidance remains available without dominating repeat visits.

## F07 Names and labels make users decode internal concepts

**Observed:** analysis titles and review rows rely heavily on abbreviated identifiers. Model settings use names such as maxOutputTokens and topP. Time limits are entered in milliseconds. Analysis introduces classification steps, stride, overlap, and provider input headroom.

Some of these terms are necessary research concepts. Their presentation should teach the relationship without making the internal field name the default interface language.

Use descriptive names derived from source experiment, condition, model, and settings, with optional user naming. Keep canonical identifiers available through copy controls or details. Prefer readable units and explain unfamiliar concepts where users make the corresponding choice.

**Acceptance criteria**

- Records can be distinguished using meaningful context without memorizing ID suffixes.

- Shortened identifiers remain copyable in full and never serve as the sole accessible name.

- Duration inputs display human units with exact conversion to stored values.

- Technical labels have concise definitions and units where needed.

- Terminology distinguishes experiment, matched pair, run, analysis, evaluation, window, and judgment consistently.

## F08 Pair comparison provides little comparative evidence

**Observed:** Pair comparison shows two run rows and a configuration-difference payload listing condition.id and condition.text. It confirms matching outside those fields but offers little help comparing what happened.

The page title sets an expectation that users can examine the conditions together. Returning to separate run pages forces them to remember details across navigation.

Provide aligned condition panels with condition wording, completion state, evidence availability, final artifacts, and reports. Include a readable configuration difference view. Offer matched navigation into the underlying evidence without asserting unsupported statistical conclusions.

**Acceptance criteria**

- Users can read the exact condition wording for both runs together.

- Matching and differing configuration values are understandable without reading field-path JSON.

- Available execution and output summaries align across the two runs.

- Incomplete or failed runs remain visible and are not silently excluded.

- The interface does not turn one pair into a model ranking or treat within-run events as independent experimental units.

## F09 Long research text is cramped into small editors

**Observed:** Codebook uses a helpful behavior list and detail editor, but inclusion and exclusion criteria occupy small adjacent textareas with internal scrolling. Other configuration pages also use compact editors for instructions and policy text.

The form is orderly, yet its dimensions are poorly matched to the content. Reviewing a definition requires enough visible context to compare criteria and examples.

Use full-width or generously sized text editors for substantial prose. Let fields grow to a sensible limit and provide an expanded editor for longer content. Preserve the distinction between individual criteria if they are stored as separate items.

**Acceptance criteria**

- Representative real definitions can be read and edited without constant nested scrolling.

- Multiline item conventions are explicit and preserve intentional line breaks.

- Expanded editing retains focus, current content, and unsaved state.

- Save status and validation remain visible when an editor is expanded.

- Revisions and historical definitions remain inspectable without becoming editable accidentally.

## F10 Review queues reveal identifiers more readily than actionable context

**Observed:** the saved review batch lists abbreviated window IDs, sampling provenance such as flagged or random, and repeated Review evidence actions. A new selection form remains above the queue. The visible rows do not make step ranges or per-item review progress immediately apparent.

A reviewer should be able to resume a task without reconstructing its place in the analysis. The queue also needs to respect blind review: contextual help must not reveal model scores or selection reasons when those are supposed to be hidden.

Separate creating a selection from working through an existing one. Show window number, step range, progress, and relevant scope information. Provide save and next, explicit skip, and return-to-queue behavior.

**Acceptance criteria**

- Existing batches can be opened without configuring a new batch.

- Review progress distinguishes unreviewed, saved, revised, and skipped items according to the agreed workflow.

- Save and next advances only after the current save succeeds.

- A failed save preserves the draft and offers retry.

- Blind mode hides scores and revealing sampling cues across the queue, inspector, and related summaries until the intended reveal point.

## F11 Breadcrumbs and view controls provide incomplete orientation

**Observed:** deep run and analysis pages still show broad breadcrumbs such as Workspace / Runs or Workspace / Analysis. Some pages supply their own back links, but the top-level location does not name the current record.

**Source confirmed:** the shared view controls are buttons with aria-pressed rather than a tablist with associated tab panels. They visually resemble tabs. This warrants a targeted semantic and keyboard check; it is not evidence that the entire interface is inaccessible.

Provide contextual breadcrumbs with a meaningful record label. For view switching, choose either navigation links or a complete tab interaction pattern and implement it consistently.

**Acceptance criteria**

- Deep pages identify both the containing collection and the current record.

- Back navigation returns to a predictable state without discarding relevant filters.

- View controls expose the selected view and its content relationship appropriately.

- Keyboard behavior matches the chosen control pattern.

- Route changes, drawer opening, and drawer closing place focus predictably.

## F12 Service and job status need a clearer operational model

**Observed:** Overview distinguishes an API connection from worker availability, and worker availability was unknown in the inspected workspace. Run timelines also display a Live refresh indicator for completed runs.

These labels describe different things: the freshness of browser data, whether a service is reachable, whether a worker can accept work, and whether a particular job is executing. A user can easily conflate them.

Present those states separately and explain what the user can do. For completed runs, use wording such as Updated at or Refreshing evidence when that is what the indicator represents. Show demo mode as a workspace property, not only as a label on particular records.

**Acceptance criteria**

- A reachable API does not imply a healthy or available worker.

- Unknown worker status is distinct from unavailable and includes an explanation when known.

- Stale data stays visible with a clear timestamp and retry path.

- Queued, running, stopping, cancelled, failed, and interrupted jobs retain their distinct meanings.

- The demo workspace clearly explains that records and jobs are simulated and that its in-memory data resets on restart.

## F13 The initial chart view makes cross-behavior scanning laborious

**Observed:** an analysis initially opens a probability timeline with nine enabled behaviors rendered as vertically stacked plots. Heatmap and Accessible scores are available as separate views.

Small multiples are useful for following individual behaviors, but a long stack requires scrolling to find where attention is warranted. The human-review workflow needs a fast route from a window of interest to its source evidence.

Consider a compact overview of coverage and candidate windows, with heatmap or timeline chosen by task. Preserve small multiples for detailed inspection. Make threshold changes visibly affect display or candidate filtering only, according to the selected control's purpose.

**Acceptance criteria**

- The analysis first communicates coverage, failures, and missing results.

- A reviewer can move from a plotted or tabulated window to the exact evidence.

- The same values and missingness are available through an accessible table.

- Behavior identity is conveyed by text as well as color.

- Display thresholds do not alter frozen predictions or silently change saved review selections.

## F14 Repeated guidance competes with task content

**Observed:** cautionary and technical explanations appear in page introductions, banners, helper text, sidebars, and footers. The scientific distinctions are important, but repeated general guidance competes with the decision being made.

Give each message a clear purpose: immediate consequence, short explanation, or reference material. Keep warnings about score interpretation next to scores, provider-visible inputs next to evidence selection, and irreversible freezing next to launch.

**Acceptance criteria**

- Each primary action has a concise explanation of its immediate effect.

- Detailed methodological guidance is available on demand.

- Repeated background statements are consolidated without removing essential research boundaries.

- Error and warning language identifies the consequence and a useful next action.

- Small muted text is reserved for secondary information, not required steps.

# Proposed navigation and page structure

Preserve familiar top-level concepts where possible. Introduce a review destination only if testing confirms that reviewers frequently work across analyses and need a dedicated entry point.

| Destination | Default content | Primary action |
| --- | --- | --- |
| Overview | Active work, attention items, recent results, service freshness | Resume work or create an experiment |
| Experiments | Saved drafts and experiment configurations with associated pairs | New experiment |
| Runs | Searchable execution records with condition and state filters | Open run or matched pair |
| Analysis | Existing analyses across source runs with coverage and status | New analysis |
| Review | Pending work and saved selections across analyses, if adopted | Continue review |
| Codebook | Available codebooks with clear current and historical revisions | Edit current definitions or create a codebook |
| Oversight | Evaluation jobs and comparisons | New evaluation |

An experiment workspace should connect its configuration, matched pairs, runs, analyses, and reviews without collapsing their independent lifecycles into one status. Cross-links should carry context when useful, but should not silently inherit inference settings that must be chosen independently.

A useful run detail structure is summary, timeline, board and deliveries, artifacts, private memory, reports, model and traces, and configuration. The existing evidence categories are a good foundation. Add the summary and contextual next actions rather than replacing the evidence model.

## Proposed experiment flow

1. Choose a supported scenario or an existing draft.

2. Review the task, policy, and dataset.

3. Select model and roles; inspect advanced settings when needed.

4. Set execution limits using clear units.

5. Validate and review the exact matched conditions and frozen configuration.

6. Launch and arrive at the pair's execution view.

Keep save available throughout. Make the difference between a local recovery copy and a shared saved draft explicit. Do not automatically modify technical settings as a side effect of simplifying their presentation.

## Proposed analysis flow

1. Choose a source run and frozen definition revision.

2. Select evidence categories and window settings.

3. Preview coverage, input sizes, and expected requests.

4. Resolve or explicitly accept unscored windows.

5. Launch and arrive at progress or results.

6. Inspect evidence or create a human-review selection.

Existing analyses should remain one navigation action away from the source run and discoverable from the global analyses list.

## Proposed review flow

1. Open an existing batch or create a reproducible selection.

2. Confirm reviewer identity and the applicable review mode.

3. Read the relevant behavior definition and source evidence.

4. Select supporting events and record present, absent, or uncertain with rationale.

5. Save, verify success, and advance or return to the queue.

6. Revise through an appended judgment when needed, preserving history.

Keep provisional window or event annotations separate from run-level reference outcomes. A convenient review experience must not erase that distinction.

# Form and interaction standards

Use a small set of predictable patterns across Experiments, Analysis, Codebook, and Oversight.

| Concern | Required behavior |
| --- | --- |
| Required fields | Mark consistently; show the reason an action is blocked |
| Optional settings | State the effective default or explain where it comes from |
| Units | Put units beside the value; support human-readable durations |
| Errors | Preserve values, explain the correction, and connect the message to the field |
| Saving | Distinguish unsaved, saving, saved, and failed states |
| Draft recovery | Say whether recovery is local to the browser or shared with the team |
| Concurrent edits | Explain a stale revision and offer a way to compare or recover edits |
| Previews | State what is included, what cannot be processed, and what the next action will do |
| Long-running work | Confirm submission and provide a persistent status destination |
| Destructive changes | Describe the affected object and recovery behavior before committing |
| Raw records | Keep exact data available in a secondary view with copy or export |
| Selection controls | Use named choices where valid options are known; retain explicit custom input where supported |

A visually compact interface is not necessarily efficient. Optimize for the number of decisions users must understand and the amount of context they must remember, rather than simply reducing page height.

## Terminology examples

| Current wording | Candidate wording | Qualification |
| --- | --- | --- |
| maxOutputTokens | Maximum output tokens | Preserve the provider parameter mapping |
| Request timeout ms | Request timeout in seconds | Convert exactly when saving |
| Maximum run duration ms | Maximum run duration in minutes | Allow precise values when needed |
| Durable review selection | Review batch | Explain reproducible selection in helper text |
| Accessible scores | Score table | Make accessibility a property of every view |
| Linked evidence event IDs | Supporting evidence | Use selectable event references |
| Analysis followed by an opaque ID | Source name and condition with analysis settings | Keep the canonical ID in details |
| excluded | Excluded from operator review | Preserve the study's actual condition terminology |

Do not rename domain terms casually. In particular, choose wording for reviewed and excluded conditions with the study owners so the UI remains faithful to the experimental manipulation.

# State and recovery requirements

These are acceptance targets for the redesign. Except where described in the findings, they still require deliberate testing.

| State | What the user should see | What must be preserved |
| --- | --- | --- |
| First use | A clear starting action and brief workflow explanation | Access to examples without confusing them with study results |
| No records | A contextual empty state | Filters and the ability to create appropriate work |
| No filter matches | Which filters are active and a clear reset | The distinction from a genuinely empty workspace |
| Loading | An activity indication scoped to the affected area | Layout stability and existing data where appropriate |
| Disconnected or stale | Last successful update and retry | Previously loaded evidence and local edits |
| Validation failure | Actionable field errors and a concise summary | Every unaffected input |
| Save failure | Failed status with retry or recovery | The unsaved draft and intended revision |
| Revision conflict | A stale-version explanation and comparison path | Both the user's edits and the newer saved record |
| Queued job | Queue state and relevant worker availability | A stable job link |
| Partially processed analysis | Coverage and per-window failure reasons | Missingness and unchanged window boundaries |
| Cancellation requested | Stopping or cancellation-requested state | The distinction from terminal cancellation |
| Archived definition | Historical availability and current-use restriction | Existing analysis and review references |

A refresh must not duplicate a submission. Retain the existing stable request identity and frozen preview protections while changing the interaction design.

# Research safeguards to preserve

The dashboard's methodological care is a strength. Simplification should improve access to that care rather than remove it.

- A matched pair changes only the intended review-condition wording; all other frozen settings remain verifiable.

- Researcher evidence remains recorded in both conditions.

- Jev estimates remain exploratory window-level screening results, separate from human annotations and run-level references.

- Missing or failed scores remain distinct from zero and from an absent behavior judgment.

- Blind review conceals predictions and revealing cues until the defined point in the process.

- Sampling provenance, seed, population, selection reasons, and frozen settings remain exportable.

- Definition edits create revisions and preserve historical interpretation.

- Oversight views remain isolated and exclude prohibited sources such as human reference labels or other monitor outputs.

- Independent jobs retain independent states; closing a browser does not imply cancellation.

- Human-readable evidence views retain exact links to canonical records and do not rewrite or summarize away uncertainty.

Avoid adding automated narrative conclusions to the evidence view merely to make it friendlier. Readable formatting, structured event grouping, and explicit citations provide substantial usability gains without introducing another interpretive model layer.

# Delivery sequence

## Stage one Remove immediate friction

Address F04 and F05 first: explain blocked actions, mark prerequisites, and make scoreless analysis outcomes explicit. Improve record labels and clarify demo and service status. These changes are relatively contained and establish shared interaction patterns.

Completion means the inspected preview and validation cases have unambiguous outcomes, with no changes to scientific computation or source evidence.

## Stage two Make existing work discoverable

Address F02, F06, F07, and F11 together. Introduce consistent collection landing pages, contextual breadcrumbs, and a more operational overview. Preserve direct links and list state.

Completion means a returning collaborator can locate a known draft, completed analysis, review batch, and matched pair without entering an unrelated creation form.

## Stage three Rebuild evidence review

Address F01 and F10 as one workflow. Implement readable events, selectable citations, a usable judgment panel, and reliable save-and-next behavior. Validate blind and assisted modes separately.

Completion means a reviewer can finish a batch without manually transferring identifiers, while every judgment retains its exact evidence scope and append-only history.

## Stage four Simplify setup and comparison

Address F03, F08, F09, F13, and F14. Add progressive disclosure, better long-text editing, meaningful pair comparison, and task-appropriate result overviews. Consolidate guidance after the workflows have stabilized.

Completion means users can configure and compare research work without losing access to advanced controls or provenance.

Effort and scheduling should be estimated after checking API coverage. A global review queue, aggregate progress counts, or richer comparisons may need backend support; interface designs should not imply those capabilities already exist.

# Validation plan

## Task based usability sessions

Recruit a small formative sample of researchers, including collaborators who did not build the dashboard. Observe real task completion before explaining the interface. Establish a baseline with the current UI and repeat the same tasks on the revised workflows.

| Task | Successful behavior | What to record |
| --- | --- | --- |
| Resume a saved experiment | Opens the intended draft and identifies its save state | Wrong destinations, hesitation, assistance |
| Configure a matched pair | Identifies the condition difference and validates settings | Misunderstood fields, corrections, confidence |
| Find a completed analysis | Locates it without creating new work | Navigation detours and source-selection confusion |
| Handle an oversized preview | Predicts which windows will receive scores | Incorrect launch expectations |
| Review a window | Reads evidence, attaches correct citations, saves a judgment | Citation mistakes, scrolling, unsaved work |
| Resume a batch | Finds the next appropriate item and its review state | Lost context and repeated work |
| Compare a matched pair | Explains configuration differences and locates both outputs | Cross-page memory burden |
| Recover from failure | Recognizes stale data or a failed save and recovers safely | Duplicate submissions or lost edits |

Measure task completion, assistance required, incorrect submissions, time on task, and a short post-task ease rating. Treat improvements as hypotheses until measured. Do not claim time savings or error reductions from the heuristic audit alone.

## Accessibility and responsive checks

Run these checks across representative forms, a long run timeline, analysis results, and the evidence inspector:

- Complete the primary journeys using only a keyboard.

- Verify visible focus, logical order, dialog focus management, and focus restoration.

- Test view controls according to their chosen link or tab semantics.

- Verify required fields, errors, saved states, and background updates with a screen reader.

- Measure text and non-text contrast in both themes, including disabled and warning states.

- Test narrow layouts and enlarged text without losing essential actions or causing whole-page horizontal scrolling.

- Ensure charts have usable text or table alternatives and do not communicate solely through color.

- Check that sticky controls do not cover focused fields or content.

- Test long names, multiline definitions, many roles, large batches, and empty collections.

These are unverified test requirements, not confirmed failures in the current build.

## Functional regression checks

Focus automated checks on meaningful behavior: draft preservation, field validation, preview invalidation, scoreless outcomes, exact citation mapping, blind-mode information boundaries, save failures, stale revisions, and idempotent submission. Add interaction coverage for primary navigation and deep links. Use visual checks for table overflow and long-editor layout where functional assertions cannot demonstrate usability.

Test failure and recovery states with controlled fixtures rather than launching paid model jobs solely to exercise interface behavior.

# Decisions before implementation

The following choices affect the design enough to settle early:

1. Should Experiments represent a saved configuration, a study grouping, or both? Define the relationship to matched pairs and runs before naming the collection.

2. Do reviewers routinely work across analyses? If so, a dedicated Review destination is justified; otherwise start with clearer per-analysis queues.

3. Should an all-unscored analysis be saveable as an explicit record? Agree on the action and wording without changing missing-score semantics.

4. Which scenario, dataset, provider, and model choices can the backend enumerate reliably? Use that answer to determine where selectors can replace free text.

5. Which reviewer identity behavior is appropriate for the open workspace? Simplify repeated entry while keeping the claimed and unverified nature clear.

6. What desktop and narrow-screen use cases are actually required for this research team? Set acceptance viewports accordingly.

7. Which operational facts can the API report reliably about worker availability and review progress? Do not manufacture certainty in the UI.

These decisions should refine the proposed solution, not delay the immediate fixes to blocked-action explanations, record discoverability, and evidence readability.

# Evidence and implementation references

The observed findings refer to the November 7 desktop walkthrough of the seeded workspace. Useful entry points are [Overview](http://localhost:4311/), [Experiments](http://localhost:4311/experiments), [Runs](http://localhost:4311/runs), [Codebook](http://localhost:4311/codebook), [Analysis](http://localhost:4311/analysis), and [Oversight](http://localhost:4311/oversight). Seeded record identifiers change when the demo restarts, so issue reproduction should use the named fixture and condition rather than a saved random ID.

Relevant repository locations for implementation planning are:

- `dashboard/src/App.tsx`: top-level navigation, breadcrumbs, and shared run rows.

- `dashboard/src/pages/Overview.tsx`: count cards, activity, research-job lists, and service information.

- `dashboard/src/pages/Experiments.tsx`: setup, local draft recovery, validation, and launch review.

- `dashboard/src/pages/Analysis.tsx`: source selection, preview gating, analysis results, review batches, and evidence judgments.

- `dashboard/src/pages/Runs.tsx`: run inspection and pair comparison.

- `dashboard/src/pages/Codebook.tsx`: behavior definitions and revision editing.

- `dashboard/src/pages/Oversight.tsx`: monitor setup, evaluations, and human reference outcomes.

- `dashboard/src/components/ui.tsx`: shared fields, notices, drawers, JSON views, tables, and view controls.

Source inspection confirms preview prerequisites, the all-oversized launch-control behavior, the buried single-event annotation shortcut, expanded JSON defaults, and the shared view-control semantics. File contents may change after this audit; reproduce each issue against the implementation being revised.
