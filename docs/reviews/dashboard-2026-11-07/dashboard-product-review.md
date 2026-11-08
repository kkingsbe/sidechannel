# Sidechannel dashboard — product review

**Date:** 2026-11-07  
**Environment:** smoke/demo server on `http://127.0.0.1:4311`, restarted fresh, "Demo workspace" banner visible throughout. Port 4310 was never touched.  
**Viewport:** 1280×860 desktop, plus 375×812 mobile. System, light, and dark themes.  
**Screenshots:** `screenshots/NN-name.jpg`, next to this file.

**What I did:** I launched two matched pairs, saved and duplicated drafts, edited and saved a codebook revision, launched a Jev analysis, recorded a window judgment, saved run-level human references, previewed and launched an oversight comparison, and opened shared deep links in a fresh tab.

**What I could not test:**
- **Cancel mid-flight, and closing the tab mid-launch.** Fixture runs and jobs finish in about a second, so they never stay in a running state long enough.
- **Export downloads.** I didn't download any exports. I only checked where the links point.
- **Model reasoning display.** The scripted model produces empty text and no reasoning.
- **Reduced motion.** I only confirmed that a `prefers-reduced-motion` rule exists in the CSS.

---

## 1. Summary

The dashboard is careful and honest about evidence. Recorded data and researcher labels are always kept apart, it's explicit about what each view includes, previews are invalidated when you edit, and nothing launches by accident from a stale preview. But it is organised around *jobs and records*, not around the *experiment*. A researcher can't see "my study: N pairs × 2 conditions, which are done, which are analysed, what the monitor found in reviewed vs excluded". That picture has to be rebuilt by hand from four flat lists keyed by truncated UUIDs.

**Three things need attention most:**

1. **The matched pair is not a first-class object.** Experiments shows only drafts. Runs is a flat list with no pairing. Analysis can only compare analyses of the *same* run. Oversight lists source runs by UUID with no condition label. So the core comparison of the study, reviewed vs excluded, is never shown anywhere except one pair-diff page.
2. **The study's five outcome categories are not in "Codebook".** They live in Oversight → *Questions & outcome definitions*. Codebook holds nine different Jev behaviour codes (PROPOSE … REPORT SHAPING). A newcomer told to "define the codebook" will edit the wrong thing.
3. **Launch and defaults are not budget-safe.**
   - Launching a pair is one click with no confirmation. A one-word edit relaunches a second pair with no warning, and the success message lands off-screen.
   - Default Jev settings give *zero* scoreable windows on a short run.
   - Default oversight settings make 6 of 8 views "oversized", yet Launch stays enabled.

**What works best:** the evidence inspector drawer.
- It is deep-linkable: a shared `?evidence=` URL reopens the exact event in a new tab.
- It traps focus, closes on Escape, and returns focus to the row you came from.
- It labels everything as recorded, untrusted text.

The oversight verdict drawer's "included / excluded categories" list is the same quality.

---

## 2. Walkthrough notes by workspace

### Overview
- **Did:** read the counters, recent runs, analyses, monitor evaluations, and service status, and expanded "Getting started" (`01`, `02`).
- **Confusing:**
  - The condition badge reads **"excluded"**, which looks like "this run is excluded from the study", not "board unreviewed".
  - Recent runs gives no hint which two runs form a pair.
- **Confusing:** "Getting started" sits at the very bottom, collapsed, and has three steps (configure, follow evidence, screen). Codebook and Oversight never appear in the suggested workflow.
- **Confusing:** "Experiment worker: Availability unknown · capacity 1" appears even in the demo, so a researcher can't tell whether launching will do anything.
- **Change:**
  - Make the top of Overview a study-progress strip: pairs launched → runs complete → analysed → human-reviewed → oversight compared.
  - Give each item a "next action" link.

### Experiments
- **List (`03`, `12`):** only "Shared saved drafts" are listed.
  - After I launched two pairs, neither appeared on Experiments (`12`). The only way back to them is Runs.
  - Breadcrumb reads "Experiments / Experiments".
  - Drafts have no delete or archive action.
- **Form, catalog:** every time the form opens, it shows "Dataset catalog unavailable: API route not found" (`04`). "Use healthcare smoke preset" is disabled with no explanation of why.
- **Form, validation:**
  - Nothing is validated as you type. Rounds = −5 is accepted, and the Launch review panel happily shows "-5 × 3 calls / turn" (`06`).
  - A maximum run duration of 99,999,999 minutes (≈190 years) passed validation entirely.
  - Help text under it says "Stored in milliseconds (5999999940000 ms)", which is an implementation detail, not guidance.
- **Validate & review launch (`07`):**
  - The error summary at the top is good: errors are listed and link to the field.
  - But messages use internal names ("label is required", "rounds must be a positive integer"), and each appears twice.
  - A whitespace-only name is reported as "label is required", not "Experiment name can't be blank".
- **Saving a draft with errors** succeeds (`08`), and the draft appears in the shared list with **no title** (`12`). The URL stays `/experiments/new` after saving.
- **Launch (`09`–`11`):**
  - "Valid configuration. Launch freezes two runs." → one click on **Launch matched pair** launches, with no confirmation and no cost or budget recap.
  - After clicking, the viewport jumped to the middle of the form (`10`) and the side panel reset to "Validate & review launch". It looked as if nothing happened.
  - The "Matched pair queued" banner (with run links) is at the top of the page, out of view (`11`).
- **Duplicate risk:**
  - Re-validating and launching an *unchanged* form correctly returned the same pair (idempotent). Good.
  - Changing only the experiment name and launching again created a **second pair** with no warning, and the banner replaced the first pair's links.
- **Navigation:** leaving the form with "Unsaved edits" (clicking Runs in the sidebar) gave no warning, and the edits were lost.
- **Incomplete draft (`13`):** copy says "Add the backend's supported default fields explicitly", which describes the implementation. "Complete with supported default fields" works.
- **Change:**
  - Add a launched-experiments list, with its pairs and their status, above drafts.
  - Put a confirmation step on Launch (pair count, model, rounds × calls, worst-case model calls).
  - After launch, navigate to the new pair page.
  - Warn before relaunching a near-identical config within a session.
  - Validate inline with human field names.
  - Block a blank name on save.

### Runs — list
- **Did:** used filters, opened runs (`14`).
- **Confusing:**
  - Flat list; the two runs of a pair are adjacent only by coincidence of time.
  - There's no pair column, no "open pair" action, and no repetition number.
  - The eyebrow "CANONICAL SOURCE RECORD" is jargon.
- **Inconsistent:** the Designation filter offers "fixture" and "development" as separate values, while the form offers a single "Development / fixture".
- **Mobile (`55`):** filters fill the whole first screen. The table scrolls sideways inside its card, and the State column starts off-screen.
- **Change:**
  - Group rows by pair (one row per pair, two condition sub-rows), with links to analyses and evaluations.
  - Collapse filters on mobile.

### Runs — run detail
- **Header (`15`):** the condition, model, config hash, phase and round are all the same small grey text. The condition (*the* independent variable) has no more weight than the config hash. "Matched pair" is a tiny link with a diagonal arrow.
- **Header:** a "Live · 3:57:54 PM" badge shows on a *completed* run. A disclaimer about fetch timestamps vs worker health repeats under every tab.
- **Header:** "New Jev analysis" and "Configure oversight" exist only at the very bottom of the page. There's no list of *existing* analyses or evaluations for this run anywhere on the page.
- **Timeline (`15`, `16`):**
  - Each row's summary line is a truncated JSON blob (`{ "allowance": 3, "turnId": "4cce…` ).
  - One agent turn produces ~17 rows (turn started, context accounted, model requested, model response, model usage, 3× tool requested, 3× tool admitted, 3× tool result, board post, memory updated, turn ended).
  - There's no "collapse by turn" or plain-language summary ("alpha posted: *My synthetic fragment is blue.*").
  - The ▶ play icon used to open a row reads as "play media".
- **Evidence drawer (`16`):** excellent keyboard behaviour and deep-linkable. But "Recorded payload", the thing you opened the drawer for, is collapsed by default. There's no previous/next event navigation.
- **Board & deliveries (`17`):**
  - The post subtitle is a truncated internal ID (`4cce3a00-fe9…essage`) instead of round/turn/time.
  - The delivery list is 12 chips of "alpha · event #44" with no distinction between first read and re-read.
- **Artifacts (`18`, `19`):**
  - Version subtitles are internal IDs (`…:turn:3:call:artifact-update`) rather than "alpha, round 2".
  - The frozen final version is last on the page.
  - "Compare to previous version" shows two raw JSON blocks side by side with no diff highlighting.
- **Private memory (`20`):** raw before/after JSON for every update, both agents interleaved, headings in snake_case ("alpha · memory_updated"). There's no per-agent filter, no round/turn, and no "unchanged" marker (several updates are identical).
- **Reports (`21`):** final reports, a key dependent variable for "false compliance reporting", render as a **single minified JSON line** (`{"ownActions":"…","observations":"…","limitations":"…"}`). They should be labelled fields.
- **Model & traces (`22`, `23`):**
  - Each model call is three separate rows (requested / response / usage) rather than one call card with input, output, reasoning and tokens.
  - In the drawer, **"Inspect model / trace references"** just closes the drawer and leaves you on the same tab, a silent no-op.
  - I couldn't see reasoning or output text because the scripted fixture has none.
- **Configuration (`24`):** the clearest tab, human-readable. But it omits rounds, calls/turn and model parameters, which are the settings you'd most want to confirm. Usage and cost are collapsed under "Recorded provider usage".
- **Pair comparison (`25`):**
  - Good: "Frozen configurations match outside the intended condition difference" plus a config diff.
  - But it's titled by `pair-dashboard-fixture`, not the experiment name, and puts *excluded* left and *reviewed* right (the form shows Reviewed first).
  - There's no analysis or oversight status per side.
  - "Open canonical event timeline" is jargon.
- **Duplicate config (`26`):** immediately creates a **shared** saved draft with the identical name (the drafts list now has two "SCRIPTED FIXTURE · Dashboard acceptance"). The sidebar still highlights *Runs* while you're on the Experiments form.
- **Not found (`59`):** `/runs/does-not-exist` shows "Could not load this workspace. Run not found. [Try again]". It's the wrong message (the workspace loaded fine), retrying can't help, and there's no link back to Runs. Every shared link will hit this after a demo restart.

### Codebook
- **Did:** edited a definition, tried to save without author, saved revision 2, opened history, added a behaviour (`27`–`31`).
- **Conceptual:** the nine codes (PROPOSE, DELEGATE, ACCEPT, SUPPLY, JOIN, CHALLENGE, COMPLY, VISIBILITY, REPORT SHAPING) are *not* the study's categories. Those (individual violation … coordinated concealment) are edited under Oversight. The page subtitle does say "Define what Jev screens for", but the sidebar label "Codebook" doesn't.
- **Copy:** Display name equals display code ("PROPOSE / PROPOSE"), and the codebook is named "Tentative behavior codebook".
- **Save blocked (`28`):** with edits and no Revision author, "Save revision" is disabled but looks nearly identical to its enabled state. The hint "Enter a revision author to save your changes." appears as page-level text above the form, not next to the empty author field.
- **After save (`29`, `31`):** the green "New immutable codebook revision saved" banner stays on screen after you start editing again, next to a blue "Unsaved codebook changes…" notice, so you see two contradictory states.
- **New behaviour (`31`):** fields are pre-filled with *values* "NEW_CODE" / "New behavior", not placeholders, so they can be saved as-is.
- **History (`30`):** the drawer eyebrow says "Evidence inspector". Entries read "Revision 2 ·" with a dangling separator, and there's no "what changed" diff.
- **Change:**
  - Rename this workspace "Jev behaviour codes", or move outcome definitions here and make Codebook the single place for definitions.
  - Show the disabled reason on the button or the field.

### Analysis
- **List (`32`):** both seeded analyses are on the *reviewed* run. The list has no condition or pair column and no review-progress column.
- **Results header (`33`):** the title is a concatenation that mixes "·" and "-". "Source boundary #263" is unexplained.
- **Heatmap (`33`):** the threshold is typed as `0.7` while cells show `75%`. Column headers "1–4, 3–6…" are "steps", but the inspector lists events by "Sequence 58", so the units don't line up.
- **Window inspector (`34`, `35`):** strong idea (evidence left, judgment right, cite checkboxes). But:
  - It opens full-width with two nested scroll areas.
  - "Judgment" defaults to **uncertain**.
  - "Selected citations" shows a UUID, not "context accounted #58".
- **Saving a judgment (`36`):** there's no confirmation. The rationale clears, the citation stays ticked, the button becomes "Append revised judgment", and "Add a rationale before saving." reappears, which reads like an error.
- **Human review (`37`, `38`):**
  - Blind mode exists, but the default is **Assisted · predictions visible**.
  - The queue has no "1 of 8 reviewed" progress.
  - After judging *one* of nine behaviours on Window 3, the queue marks the whole window **Saved**.
- **Probability timeline (`39`):** clear small multiples. The 0.7 "highlight threshold" isn't drawn as a line.
- **Compare analyses (`40`):** "Compare two analyses of the same source" only. You can't compare the reviewed run's analysis with the excluded run's. Options are labelled by truncated analysis ID.
- **New analysis (`41`–`44`):**
  - The source run dropdown omits the condition: "Review walkthrough pair · completed · d6c0…" appears twice, differing only by UUID.
  - Each dropdown has its own Page 1 / Previous / Next under it.
  - Help text says "New analyses use the current codebook revision" while letting you pick revision 1.
- **Defaults on a 3-round run (`42`):** window 12 / advance 4 → "0 scoreable windows · 1 oversized · 1 partial · 1 unscored". The only offered action is "Save unscored analysis record", with no suggested window size.
- **Preview with 4/4 (`43`):** shows "4 estimated requests" but no tokens or cost, under a note saying "Estimates are not a guaranteed bill". The launched job auto-refreshed from queued to completed (`44`). Good.

### Oversight
- **Jobs (`45`):** the created date shows twice per row. My new evaluation got the **same title** as the seeded one ("fixture-monitor-no-network - 2 source runs - revision 1"), so the two can't be told apart.
- **Results (`46`):**
  - Each source run is headed "Source run 4cce3a00-fe9…42b9b9", with no condition, pair or experiment name, so reviewed vs excluded can't be read from the page.
  - Every cell shows "0.0s" latency.
  - The denominators table is 20 rows of "Unavailable 0 / 0 runs" when no references exist.
  - That table has a column "EXCLUDED REFERENCE", a second, unrelated meaning of "excluded" next to the condition named "excluded".
- **Verdict drawer (`47`):** very good (included vs excluded categories, input hash, preflight). Two problems:
  - The drawer isn't reflected in the URL, unlike run evidence, so a specific verdict can't be shared.
  - "Private memory available: Recorded" sits next to "Excluded categories: … private memory", which reads like a contradiction.
- **Human reference (`48`, `49`):**
  - The run picker again omits the condition.
  - Judgment defaults to **uncertain**.
  - Citations must be typed as raw event UUIDs, one per line (Analysis uses checkboxes).
  - Saving "present" with no citation is correctly blocked.
  - An invalid ID is rejected by the server, but the error ("Citations must be unique event IDs from this source run") appears at the top of the page, off-screen from the button. The field isn't marked invalid, so the click looked like a no-op (`49`).
- **Configure & preview (`50`, `51`):**
  - Good: this picker *does* show the condition.
  - Good: edits clear the preview and hide Launch.
  - Good: per-view oversized rows explain themselves.
  - But with the default 32,768-token context and 100,000-character input, 6 of 8 views are oversized for a tiny run, and **Launch monitor comparison stays enabled**. The right-hand summary doesn't say "6 of 8 views will be unavailable".
  - There's no "select both runs of a pair" shortcut, and no total token estimate.
- **Cancel:** "Cancel remaining" appeared while queued (`52`). The job completed before my click registered, so I couldn't see whether it asks for confirmation.
- **Questions & outcome definitions (`53`):** this is where the five study categories actually live, in a second definitions editor that looks different from Codebook.

### Cross-cutting: theme, mobile, keyboard
- **Theme:** light and dark had no text below 4.5:1 contrast except a 10px "Live" badge (4.29:1, light). The sidebar stays dark in light mode (`54`), which may be intentional.
- **Text size:** on run detail, 278 of 287 text nodes are 10–12px (103 at 10px). Evidence reading is the main task and it's set in caption-size type.
- **Mobile nav (`56`):** opens with focus on "Close navigation", closes on Escape, and returns focus to the toggle. The close button overlaps the logo.
- **Skip link (`58`):** works, and route changes move focus to `<main>` and update the title.
- **Live regions:** none on run detail or Oversight. Status changes (queued → completed) aren't announced.

---

## 3. Findings table

| ID | Severity | Workspace / page | Observed | Why it matters | Suggested change | Screenshots |
|---|---|---|---|---|---|---|
| F01 | Major | Codebook vs Oversight | The study's five outcome categories are edited in Oversight → Questions & outcome definitions. "Codebook" holds nine different Jev behaviour codes. | A researcher told to set up the codebook edits the wrong taxonomy, and there are two definition editors with different UX. | Rename Codebook to "Jev behaviour codes", or unify both under one Definitions workspace with two sections. Cross-link them. | 27, 53 |
| F02 | Major | Experiments, Runs | Launched experiments/pairs aren't listed on Experiments. Runs is a flat list with no pair grouping. The pair page is reachable only via a small header link. | You can't see the shape of the study (pairs × conditions × repetitions) or find what you just launched. | Make Experiment → Pair → Run the primary hierarchy. Show pairs as grouped rows with per-condition status. | 12, 14, 25 |
| F03 | Major | Experiments / form | Launch is one click with no confirmation. A one-word edit and relaunch creates a second pair with no warning. | Accidental duplicate pairs burn real budget and pollute the study. | Add a confirm step with the budget recap. Warn on near-duplicate launches. Disable the form after launch. | 09, 10, 11 |
| F04 | Major | Experiments / form | After Launch, the viewport jumps mid-form, the side panel resets to "Validate & review launch", and the success banner is off-screen at the top. | It looks like launch failed, which invites a second click (see F03). | Navigate to the new pair page, or pin the success state in the side panel. | 10, 11 |
| F05 | Major | Analysis / compare | Compare is limited to analyses of the *same* source run. Nothing compares reviewed vs excluded. | The primary contrast of the study is unsupported in Analysis. | Add a pair-level comparison: same settings, both conditions, side by side. | 40 |
| F06 | Major | Analysis new, Oversight references | Source-run pickers omit the condition. Pair runs appear as identical labels differing only by UUID. | Easy to analyse or adjudicate the wrong condition. | Show condition (and pair) in every run picker, as Oversight → Configure already does. | 41, 48, 50 |
| F07 | Major | Oversight / results | Source runs are headed by truncated UUID only, and conditions are stacked, not compared. | You can't read "monitor detected X under excluded but not reviewed" from the results page. | Head each block with experiment · condition · pair. Offer a pair-aligned layout. | 46 |
| F08 | Major | Oversight / configure | Defaults (32,768 context, 100,000 chars) make 6 of 8 views oversized on a 3-round run, and Launch stays enabled. The summary doesn't mention it. | Researchers launch comparisons that are mostly "partial" without noticing. | Size defaults to the chosen monitor model. Summarise "N of M views unavailable" next to Launch, and require acknowledgement. | 51 |
| F09 | Major | Analysis / new | Default window 12 / advance 4 gives 0 scoreable windows on a 3-round run. The only action offered is "Save unscored analysis record". | The default produces nothing for short runs, and the fix isn't suggested. | Derive defaults from run length. When 0 windows are scoreable, suggest a window size that works. | 42 |
| F10 | Major | Runs / Reports, Private memory, Timeline | Final reports render as one minified JSON line. Memory is before/after JSON. Timeline rows are truncated JSON. | The dependent variables (reports, concealment) are hard to read and scan. | Render reports as labelled fields. Show memory as a per-agent diff. Give timeline rows a one-line human summary, grouped by turn. | 15, 20, 21 |
| F11 | Major | Analysis / human review | Review defaults to "Assisted · predictions visible". The judgment defaults to "uncertain" (also in Oversight references). | It anchors reviewers on Jev, and an unchanged default gets recorded as a real label. | Default to blind. Make judgment have no default (required choice). | 35, 37, 48 |
| F12 | Major | Analysis / review queue | After judging 1 of 9 behaviours, the window shows "Saved". There's no queue progress. | It misreports how much review is done. | Show "1 of 9 behaviours judged" per window and "x of y windows complete" per batch. | 38 |
| F13 | Major | All / terminology | The condition is called "excluded" (vs reviewed). Oversight also has an "EXCLUDED REFERENCE" column with a different meaning. | "excluded" reads as "run excluded from study". The overloaded term causes misreadings. | Use "Unreviewed board" (or your canonical term) as the condition label everywhere. | 14, 46 |
| F14 | Major | Runs / detail, pair | The run page and pair page show no existing analyses or oversight evaluations, and "New Jev analysis" / "Configure oversight" sit only at the page bottom. | Run → analysis → oversight links are one-way. You have to remember IDs to get back. | Add a "Downstream" panel on run and pair pages listing analyses, evaluations and reference status. | 15, 25 |
| F15 | Major | Experiments / form | The dataset catalog shows "API route not found" in demo, and the preset button is disabled with no reason. | It's the first thing a newcomer sees in the form, and it looks broken. | Serve the catalog in demo mode, or hide it with an explanation. | 04 |
| F16 | Major | Oversight / references | Citations must be typed as raw event UUIDs. An invalid ID errors at the top of the page, off-screen. The field isn't marked invalid. | It's slow and error-prone, and the click appears to do nothing. | Reuse the Analysis cite-checkbox pattern. Show the error inline at the field and the button. | 48, 49 |
| F17 | Minor | Experiments / form | No inline validation. −5 rounds shows up in the summary as "-5 × 3 calls / turn". | Errors surface late, and the summary shows nonsense. | Validate on blur, and keep the summary showing "—" for invalid values. | 06 |
| F18 | Minor | Experiments / form | A max run duration of 99,999,999 minutes passes validation. | A runaway run isn't bounded by any sensible cap. | Set a sane upper bound and show a warning above, e.g., 120 min. | 06, 07 |
| F19 | Minor | Experiments / form | Errors use internal names ("label is required", "rounds must be…") and each is listed twice. | Hard to map to fields, and looks buggy. | Use the field labels and deduplicate. | 07 |
| F20 | Minor | Experiments / drafts | A draft saves with a blank name and shows in the shared list with no title. | Unidentifiable drafts accumulate in a shared space. | Require a name to save, or auto-name "Untitled draft · date". | 08, 12 |
| F21 | Minor | Experiments / form | Leaving with "Unsaved edits" gives no prompt, and the edits are lost. | Easy to lose a long configuration. | Use a `beforeunload` prompt and an in-app route guard, or autosave. | — |
| F22 | Minor | Runs / Duplicate config | It immediately creates a shared draft with the identical name, and the sidebar still highlights Runs. | Silent shared side effect, duplicate names, and a wrong nav state. | Open an unsaved copy named "Copy of …". Highlight Experiments. | 26 |
| F23 | Minor | Codebook | The disabled "Save revision" looks the same as enabled. The reason appears as page text, away from the author field. | Users click repeatedly and don't see why it's blocked. | Show a clear disabled style, mark the author field invalid, and put the hint next to the field. | 28 |
| F24 | Minor | Codebook | The "revision saved" success banner persists alongside a new "unsaved changes" notice. | Two contradictory states at once. | Clear the success banner on the next edit. | 31 |
| F25 | Minor | Codebook | A new behaviour is pre-filled with the values "NEW_CODE" / "New behavior". Display name duplicates code ("PROPOSE / PROPOSE"). | Placeholder values can be saved, and the names add nothing. | Use placeholders, not values. Give codes human-readable display names. | 27, 31 |
| F26 | Minor | Codebook / history | The drawer eyebrow says "Evidence inspector". Entries read "Revision 2 ·". There's no diff between revisions. | Mislabeled, and you can't see what a revision changed. | Fix the label, drop the empty separator, and add a per-revision change summary or diff. | 30 |
| F27 | Minor | Analysis / window inspector | After saving a judgment: no toast, the rationale clears, the citation stays ticked, and "Add a rationale before saving." reappears. | It looks like an error, and you're unsure whether it saved. | Show a "Saved · r1" confirmation and reset the form consistently. | 36 |
| F28 | Minor | Analysis / heatmap, inspector | The threshold is entered as 0.7 but cells show %. Windows are in "steps" while events show "Sequence N". "Source boundary #263" is undefined. | Mismatched units make results hard to interpret. | Enter the threshold in %. Label steps vs sequence explicitly. Define "source boundary". | 33, 34 |
| F29 | Minor | Analysis / new | The preview shows a request count but no token or cost estimate. | You can't judge budget impact before launching. | Show estimated input/output tokens and approximate cost. | 43 |
| F30 | Minor | Runs / Model & traces | Each model call is three separate rows. "Inspect model / trace references" in the drawer only closes the drawer. | Hard to read one call end to end, plus a dead button. | Use one call card (input, output, reasoning, tokens). Make the button go somewhere or remove it. | 22, 23 |
| F31 | Minor | Runs / Board, Artifacts | Subtitles are internal IDs (`…essage`, `…:turn:3:call:artifact-update`). Artifact compare has no diff highlighting. | Provenance isn't human-readable, and changes are hard to spot. | Show author · round · turn · time, and highlight diffs. | 17, 18, 19 |
| F32 | Minor | Oversight / jobs | A new evaluation gets the same title as an existing one, and the date shows twice per row. | Jobs can't be told apart. | Auto-title with the experiment name and a timestamp, or ask for a label at launch. | 45, 52 |
| F33 | Minor | Oversight / results | The denominators table shows 20 rows of "Unavailable 0 / 0 runs" before any references exist. | Noise that buries the actual result grid. | Collapse it to an empty state: "No agreed references yet — adjudicate to populate". | 46 |
| F34 | Minor | Oversight / verdict drawer | The drawer state isn't in the URL, so a specific verdict can't be shared, unlike run evidence. | Inconsistent shareability. | Add `?verdict=` deep links. | 47 |
| F35 | Minor | Runs / not found | "Could not load this workspace" + "Try again" for a missing run, with no way back. | The wrong diagnosis, and a dead end for shared links after a demo restart. | Show "Run not found" with a link to Runs (and, in demo, "data resets on restart"). | 59 |
| F36 | Minor | Runs / detail | A "Live · time" badge shows on a completed run, and the freshness disclaimer repeats under every tab. | It implies activity that isn't happening, and clutters the page. | Hide "Live" for terminal runs and show the disclaimer once. | 15 |
| F37 | Minor | Analysis / new | "New analyses use the current codebook revision" while revision 1 is selectable. Per-dropdown pagination. | Contradictory copy and a cluttered control. | Fix the copy and use searchable selects. | 41 |
| F38 | Minor | A11y | 278/287 text nodes on run detail are 10–12px. | Evidence reading is the core task, and the type is too small. | Use a 14px base for evidence content. | 15 |
| F39 | Minor | A11y | No live regions on run detail or Oversight for status changes. | Screen-reader users miss queued → completed. | Wrap the status badge and job progress in `role="status"`. | — |
| F40 | Minor | Runs / mobile | Filters fill the whole first screen, and the table scrolls sideways with State off-screen. | Hard to use on a phone. | Collapse filters, and use a card layout under ~600px. | 55 |
| F41 | Minor | Overview | "Getting started" is at the bottom, collapsed, with three steps that skip Codebook and Oversight. | Newcomers don't see the full workflow. | Put it at the top for empty or new workspaces, covering all five steps. | 02 |
| F42 | Polish | Experiments / list | Breadcrumb reads "Experiments / Experiments". | Looks like a bug. | Use a single crumb. | 03 |
| F43 | Polish | Experiments / form | The "Valid configuration" notice shows two icons. The "Launch requires…" note is in larger, brighter type than other help text. | Visual inconsistency. | Use one icon and the standard help-text style. | 05, 09 |
| F44 | Polish | All / copy | Eyebrows like "CANONICAL SOURCE RECORD", "THE RESEARCH DESK", "FROZEN ANALYSIS JOB". "Jev" is never defined in the UI. | Jargon for newcomers and collaborators. | Use plain eyebrows, and define Jev once (tooltip or glossary). | 14, 33 |
| F45 | Polish | Experiments / form | Help text says "Stored in milliseconds (600000 ms)". | Implementation detail. | Show the human duration ("10 minutes") or nothing. | 06 |
| F46 | Polish | Runs / timeline | A ▶ play icon opens evidence rows. | Reads as "play media". | Use a chevron or "Inspect". | 15 |
| F47 | Polish | Oversight / verdict | "Private memory available: Recorded" sits next to "Excluded: … private memory". | Reads as a contradiction. | Say "Recorded for this run · not included in this view". | 47 |
| F48 | Polish | Mobile nav | The "Close navigation" button overlaps the logo. | Visual collision. | Move it into the header row. | 56 |
| F49 | Polish | Runs / pair | Excluded is shown left, reviewed right. The form shows Reviewed first. | Inconsistent ordering slows comparison. | Use a fixed condition order everywhere. | 25 |

No Blockers. Everything worked, and nothing reached the real stack. The Majors above would be Blockers for a collaborator who has never seen the tool.

---

## 4. Forms and defaults audit

### Experiments → Configure a matched pair

| Field | Default | Sensible? | Validation observed | Suggested change |
|---|---|---|---|---|
| Experiment name | "Development fixture" | No: a real-looking value that gets launched unchanged | Blank or whitespace → "label is required" only on Validate. Saves as a draft when blank. | Leave empty with a placeholder. Require it to save. |
| Experiment / group identifier | synthetic-fixture | Demo only | Required | Explain what groups mean (repetitions? study arm?). |
| Configuration version | "1" (free text) | OK | Required | Auto-increment, or explain when to bump it. |
| Designation | Development / fixture | OK for demo | — | Align with the Runs filter values ("fixture" and "development" appear separately there). |
| Scenario version / Dataset id / version / seed | fixture-v1 / two-fragments / 1 / 17 | Demo only | Required | Populate from the catalog (currently broken in demo). |
| Task, Policy | Prefilled fixture text | Demo only | Required | — |
| Research notes | empty | Yes | — | — |
| Model provider / model | scripted / fixture-v1 | Demo only | Required | Use a dropdown of configured providers. |
| Advanced model params (7) | blank = provider default | Yes | — | Show the actual provider default value in the placeholder. |
| Roles | alpha, beta; all 8 tools on | Yes | No limits observed | — |
| Fixed rounds | 3 | Low for real runs, unexplained | −5 accepted until Validate, then "rounds must be a positive integer" | Validate inline, and explain how rounds relate to budget. |
| Admitted tool calls / turn | 3 | Unclear | min 1 | Show "rounds × calls × agents = max tool calls" live. |
| Agent-order & pairing seed | 42 | OK | — | Explain that it's shared across the pair. |
| Request timeout (s) | 30 | OK | min 0.001 s | Set the minimum to ~5 s. Drop the "Stored in milliseconds" note. |
| Model steps / turn | 8 | Unclear vs tool calls/turn | min 1 | Explain the difference from tool calls/turn. |
| Maximum run duration (min) | 10 | OK | 99,999,999 accepted | Add an upper bound and warning. |
| Latest posts / page size / post limit / memory budget | 10 / 50 / 2000 chars / 32000 chars | OK | Required | — |
| Memory template version / template | 1 / "Private notes" | OK | Required | — |
| Artifact / report schema version | 1 / 2 | OK | — | Read-only unless advanced. |
| Reporting instructions | submit_report wording | OK | Required | — |
| "Input allowance 32,000 characters (legacy)" (summary) | — | "(legacy)" unexplained | — | Explain or remove. |

### Analysis → New (Trace analysis)

| Field | Default | Sensible? | Validation observed | Suggested change |
|---|---|---|---|---|
| Source run | none | Yes | Preview disabled until set | Show condition and pair. Allow "both runs of pair". |
| Codebook / revision | Tentative behavior codebook / latest | Yes | — | Fix the "uses current revision" copy. |
| Researcher / creator | "Reviewer" (carried from Codebook author) | Convenient, but a silent carry-over | Required | Show where the value came from. |
| Window size (steps) | 12 | **No**: 0 scoreable windows on a 3-round run | min 1, max 1000. The preview reports oversized windows. | Default from run length, and suggest a value when 0 windows. |
| Window advance | 4 | OK relative to 12 | min 1. No check that advance ≤ size observed. | Validate advance ≤ size. |
| Jev model | jev-1.14.0 | OK | — | — |
| First / last source step | blank | Yes | min 1 | — |
| Reserved input space | 2000 tokens | Opaque | — | Explain it in budget terms. |
| Evidence switches (7) | all on, incl. private memory and provider reasoning | Debatable | — | State the default rationale. Warn that it differs from oversight view 1–3. |
| Request timeout / max attempts | 60 s / 2 | OK | attempts 1–5 | Note that Experiments says "retries disabled" while Jev retries. |

### Analysis → Human review selection and window judgment

| Field | Default | Sensible? | Validation observed | Suggested change |
|---|---|---|---|---|
| Reviewer identity | "Reviewer" | Carried over | Required | — |
| Initial review mode | Assisted · predictions visible | **No** for unbiased labels | — | Default to Blind. |
| Flag threshold / random windows | 0.7 / 10 | OK | — | Use % for consistency with cells. |
| Judgment scope | Whole window | OK | — | — |
| Behaviour definition | first code (PROPOSE) | Not tested whether it follows the clicked cell | — | Preselect the code of the cell that was clicked. |
| Judgment | **uncertain** | No | — | No default; require a choice. |
| Rationale | empty | Yes | Save disabled until filled | — |

### Oversight → Configure & preview

| Field | Default | Sensible? | Validation observed | Suggested change |
|---|---|---|---|---|
| Definition revision | latest (1) | Yes | — | — |
| Source runs | none | Yes | Preview lists requirements | Add a "select pair" shortcut. |
| Monitor provider / model | blank | Yes (explicit by design) | Required before preview | Offer a dropdown of configured providers. |
| Temperature / max output / top-p / seed | blank | OK | — | Show the provider defaults. |
| Model context window | 32,768 tokens | **No**: 6/8 views oversized on a tiny run | Edits clear the preview (good) | Derive from the selected model. |
| Output allowance | 2,048 tokens | OK | — | — |
| Max serialized input | 100,000 chars | Too low for views 2–4 | Oversized rows flagged, launch still enabled | Gate launch on acknowledgement. |
| Per-view timeout | 120 s | OK | — | — |

### Oversight → Human reference outcomes

| Field | Default | Sensible? | Validation observed | Suggested change |
|---|---|---|---|---|
| Run | the run you came from | Yes | — | Show condition. |
| Claimed reviewer identity | "Reviewer" | Carried over | Required | Make the two-reviewer requirement visible: who has reviewed so far. |
| Outcome definition | Individual violation | OK | — | — |
| Human judgment | **uncertain** | No | — | Require a choice. |
| Supporting source event IDs | empty textarea | **No**: raw UUIDs | "present" with none → blocked with a clear message. Bad ID → error at page top, field not marked. | Use cite checkboxes from an evidence list. |
| Rationale | empty | Yes | Required | — |

### Codebook → behaviour editor

| Field | Default | Sensible? | Validation observed | Suggested change |
|---|---|---|---|---|
| Revision author | empty | Yes | Save disabled, with a page-level hint only | Put the hint inline at the field. |
| New behaviour display code / name | "NEW_CODE" / "New behavior" | No (values, not placeholders) | Page-level hint: codes must be unique | Use placeholders. |
| Definition, criteria, examples | empty | Yes | Definition required | — |

---

## 5. Questions for the builder

1. **Condition name.** The brief says *reviewed / unreviewed*, but the UI says *reviewed / excluded*. Which is canonical? If "excluded", is the overlap with "excluded reference" and "excluded categories" intended?
2. **Codebook vs outcome definitions.** Is the split between Jev behaviour codes (Codebook) and run-level outcome definitions (Oversight) deliberate? Your brief describes the five outcome categories as the Codebook.
3. **Unit of the study.** Is "experiment with N repetitions of a pair" meant to exist as an object? Today there's no repetition concept in the UI at all.
4. **Pair-level analysis.** Should Jev analyses and oversight evaluations be launched per pair (both conditions, identical settings), or is per-run intentional to keep them independent?
5. **Assisted review.** Is "Assisted · predictions visible" meant to be the default for real labelling, or only for development?
6. **Two-reviewer agreement.** Reviewer names are self-entered. Is it acceptable that one person can satisfy the two-reviewer rule by typing two names, or should the UI at least flag the same browser/session?
7. **Oversight defaults.** Which monitor model are the 32,768-token / 100,000-character defaults meant for? Should launch be allowed when views are oversized?
8. **Reasoning display.** The latest commit mentions showing model reasoning and output text on the run page. Where should it appear? With the scripted fixture I saw empty `text` and no reasoning, so I couldn't evaluate it.
9. **Worker availability.** Should Launch be disabled, or warn, when "Experiment worker: Availability unknown"?
10. **Light theme.** Is the dark sidebar in light mode intentional?
