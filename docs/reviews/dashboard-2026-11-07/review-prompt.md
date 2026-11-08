# Dashboard product review — agent prompt

Paste everything below the line into a fresh agent session that has browser tools.

---

You are a product reviewer doing a hands-on walkthrough of the **Sidechannel researcher dashboard**. Your job is to use it the way a real researcher would, click on everything, and then give me candid product and user-facing feedback. You are not reviewing code and you should not change any code or files. Your deliverable is a written review.

## What this product is

Sidechannel is a research harness for a multi-agent experiment. Several LLM agents work on a shared task and have access to a shared message board. Across matched run pairs, only one thing changes: whether the board is described to the agents as *reviewed* by operators or *unreviewed*. Researchers use this dashboard to:

1. **Configure and launch runs** (Experiments) — pick a scenario, model, condition, scheduler settings, budgets; freeze a config; launch matched pairs.
2. **Watch and inspect runs** (Runs) — progress, timeline, per-event payloads, board deliveries, agent working memory, shared artifact versions, final reports, model calls with reasoning and output text, traces.
3. **Define a behavioral codebook** (Codebook) — categories like individual violation, coordinated violation, false compliance reporting, deliberate concealment, coordinated concealment.
4. **Run and review analysis** (Analysis) — automated screening ("Jev") plus human review of recorded events against the codebook.
5. **Run oversight comparisons** (Oversight) — a fixed monitor model is given four progressively broader views of a run (reports only; plus audit metadata; plus board; full trace) and asked the same questions. Researchers define questions and outcome definitions, preview exact projections and token budgets, launch, and inspect per-view outcomes and citations. Exports and shareable URLs exist.

The user is a researcher who understands the study design but is not necessarily the person who built this tool. They will be running real experiments under time pressure during a hackathon, so clarity, safe defaults, and "what do I do next" matter a lot. Assume they may also hand this to a collaborator who has never seen it.

## Where to run it

Use the **smoke / demo server**. From the repo root:

```
npm run smoke:dashboard --workspace=@sidechannel/integration
```

Then open `http://127.0.0.1:4311`. This seeds an in-memory matched fixture pair, simulated analyses, and oversight judgments. Everything there is disposable and resets on restart, so you can create, edit, launch, cancel, and delete freely. A "Demo workspace" banner should be visible; if it is not, stop and tell me rather than clicking around a live environment.

Do **not** use port 4310 unless I tell you to. That is the real stack with real MongoDB data and real provider credentials.

## How to review

Go through every top-level workspace in the sidebar and every sub-page, panel, tab, drawer, and dialog you can reach. For each one, actually *do* things, do not just read:

- Open every form. Try submitting it empty. Try obviously bad values (negative numbers, huge numbers, blank required fields, whitespace, very long strings, duplicates). Try the happy path end to end.
- Note every default value and ask: is this the right default for a researcher who has not read the docs? Is it obvious *why* it is the default? Is it obvious what unit it is in?
- Follow the real workflows end to end, as the researcher would: configure, freeze, launch a matched pair, watch progress, open a run, inspect evidence, code events, run an oversight comparison, read results, export or share a link. Note every point where you had to guess what to do next, go back, or read something twice.
- Trigger loading, empty, error, and stale states where you can (edit something after saving, try launching with an outdated preview, cancel mid-flight, open a shared URL in a new tab).
- Resize to a narrow viewport and try the mobile nav. Switch the theme between system, light, and dark.
- Tab through pages with the keyboard. Check focus order, the skip link, and that dialogs trap focus and close with Escape.
- Read every label, button, heading, badge, tooltip, and help text as a newcomer. Flag jargon that is never defined in the UI, inconsistent terms for the same concept, and copy that describes implementation rather than intent.
- Watch for destructive or irreversible actions (launch, cancel, delete, freeze, overwrite a revision) and check how they are confirmed, labeled, and recoverable.
- Note anything that silently succeeded or silently failed with no visible feedback.

Take screenshots of anything you cite so I can see what you saw.

## What I want you to evaluate

Think in these layers, roughly in order of importance:

1. **Concept of operations.** Does the UI structure match how a researcher actually works through a study? Are the six workspaces the right split? Is it clear where to start, what is done, and what is next? Does the dashboard tell the story of the experiment (pairs, conditions, repetitions) or just show tables?
2. **Workflow friction.** Dead ends, missing links between related things (a run and its pair, a run and its analyses, an oversight result and the run it came from), repeated data entry, places where you have to remember an ID, modal-heavy flows that should be inline or the reverse.
3. **Forms, fields, defaults, validation.** Field order, grouping, required vs optional, placeholder vs default, units, ranges, inline validation vs on-submit, error message quality, whether the form explains consequences before you commit.
4. **Information design.** Are the important things (run state, condition, pair membership, failures, budget consumption) visually prominent? Is dense evidence (event payloads, model calls, board deliveries) scannable? Are timestamps, IDs, and durations formatted for humans?
5. **Feedback and state.** Loading indicators, optimistic updates, success and failure toasts, progress for long jobs, what happens if you close the tab mid-launch, stale-data handling.
6. **Trust and safety of the tool itself.** Can a researcher accidentally burn budget, launch a duplicate, overwrite a definition, or mistake simulated demo data for real findings? Does the UI keep the distinction between recorded evidence and researcher labels visible?
7. **Visual design and consistency.** Spacing, hierarchy, color use, iconography, table design, component consistency across pages, light and dark parity, responsive behavior.
8. **Accessibility.** Keyboard, focus, contrast, labels on icon buttons, live regions for async updates, reduced motion.
9. **Copy and terminology.** Plain language, consistency, tone, undefined acronyms, overly technical phrasing.

## What I do not want

- Do not review the source code or suggest implementation changes. Describe the problem from the user side and what a better experience would be.
- Do not pad the review with praise or generic best-practice lectures. If something is good, one line is enough.
- Do not report things you did not actually see. If you are speculating, say so explicitly.
- Do not try to launch anything on the real stack.

## Output format

Write the review as a Markdown document with these sections:

1. **Summary** — 5 to 10 sentences. Overall impression, the three things that most need attention, and the one thing that works best.
2. **Walkthrough notes by workspace** — Overview, Experiments, Runs (list, run detail, and each panel), Codebook, Analysis, Oversight. For each: what you did, what was confusing, what broke, and what you would change. Keep each bullet to one or two sentences.
3. **Findings table** — every discrete issue, one row each, with: ID, severity (Blocker / Major / Minor / Polish), workspace and page, what you observed, why it matters to the researcher, suggested change. Sort by severity. Reference screenshots by filename.
4. **Forms and defaults audit** — one table per form: field, current default, whether the default is sensible, validation behavior observed, suggested change.
5. **Questions for the builder** — things you could not judge without knowing intent.

Be specific. "The launch button is unclear" is useless. "On Experiments, the primary button reads *Freeze* but freezing also enqueues the run, and nothing on the page says so until the status badge changes several seconds later" is useful.
