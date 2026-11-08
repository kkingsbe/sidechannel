# JEV trace analysis

The canonical pipeline lives in `analysis-worker/src/jev/` for execution, `packages/domain/src/analysis/` for preparation, and `packages/contracts` for shared evidence types. It reads terminal harness runs and never updates their evidence or lifecycle. The researcher API is under `/api/jev`. The combined analysis/monitor worker polls this pipeline independently of the experiment worker; `npm run jev:worker --workspace=@sidechannel/analysis-worker` can also run only JEV work.

Set `TYPESAFE_API_KEY` on the worker (`TYPESAFE_AI_API_KEY` is also accepted). The API process does not need the key. The official SDK is pinned to `@typesafe-ai/sdk@0.7.0`; new analyses default to `jev-1.14.0`. Run MongoDB as a replica set: revision updates and lease-fenced result commits use transactions.

## Workflow

1. `GET /api/jev/codebooks` returns `{items,nextCursor}` and initializes the editable codebook if needed. The nine starting definitions and examples come from the researcher; added inclusion/exclusion guidance is explicitly tentative.
2. `GET /api/jev/codebooks/:id/revisions/:revisionId` returns the full definitions; `/revisions` pages their history. `PATCH /api/jev/codebooks/:id` requires `expectedRevisionId`, `creator`, and the complete `definitions` array; optional `name` and `note` are supported. Archive individual definitions instead of removing their history.
3. `GET /api/jev/codebooks?archived=exclude|include|only` filters by archive state (default `exclude`; any other value is a 400). `POST /api/jev/codebooks/:id/archive` and `/restore` take `{expectedRevisionId, actor}` and return `{codebook}`; they return 404 for an unknown codebook and 409 if the revision changed or the codebook is already archived / not archived. Archiving sets `archivedAt`/`archivedBy` without creating a revision. Archived codebooks remain readable by ID, but cannot be revised or used to preview or launch a new analysis (409). Existing analyses, reviews and exports are unaffected because they use the frozen manifest.
4. `POST /api/jev/runs/:runId/analyses/preview` takes `{codebookId,codebookRevisionId?,settings?}`. Inspect counts, availability, diagnostics, window membership and budget estimates. Defaults are 12 steps, stride 4, action/report phases and all evidence categories.
5. `POST /api/jev/runs/:runId/analyses/preview/windows/:windowId` takes the same input plus `previewHash`, and returns exact normalized input. Changed source or definitions reject the request. Inputs above the inspection transport ceiling return an explicit error; they are never truncated.
6. `POST /api/jev/runs/:runId/analyses` takes the preview input plus `previewHash`, `idempotencyKey`, `creator`, and optional `parentAnalysisId`. This freezes the manifest and materializes immutable inputs before publishing a queued job. Reusing a key with different settings is a conflict.
7. Poll `GET /api/jev/analyses/:id`; page `/windows`, `/results`, and `/attempts` with `after` and `limit` (maximum 500). Add `withResults=true` to a windows page to include its scores in one response. Inspect `/windows/:windowId` for `{window,input,results}`. `GET /api/jev/analyses` lists jobs across runs. The score applies to the entire window, plotted at `endOrdinal`.
8. `POST /api/jev/analyses/:id/cancel` stops further work. `/retry` queues only missing results against the unchanged manifest. Reruns with new settings need a new job/key. Successful results are immutable.
9. `GET /api/jev/analyses/:id/export` streams NDJSON with manifest, windows, results, attempts, immutable artifact chunks and review history. Group `artifact_chunk` records by `data.id`, sort by `data.index`, concatenate `data.text`, then JSON-parse to reconstruct an artifact. Source artifacts retain events and canonical steps; request artifacts retain exact SDK wire payloads and provider-key/code-ID mappings. Response artifacts retain raw successful HTTP bodies and validated answers; credentials/headers are excluded.

Resolved settings use this shape (all fields optional at preview):

```json
{
  "model": "jev-1.14.0",
  "window": { "size": 12, "stride": 4 },
  "selection": { "phases": ["action", "report"] },
  "evidence": {
    "assistantText": true, "toolArguments": true, "toolResults": true,
    "boardContent": true, "boardDelivery": true, "artifactChanges": true,
    "privateMemory": true, "providerReasoning": true, "finalReports": true
  },
  "concurrency": 2, "timeoutMs": 120000, "maxAttempts": 3, "retryBaseMs": 1000
}
```

`selection.startOrdinal` and `endOrdinal` refer to the stable source step grid. Evidence selection occurs after the grid is frozen. Missing outcomes remain missing; reporting is associated with its own scheduler lifecycle. Historical model messages are not reclassified as new actions. Supported reasoning extraction is explicit and availability is recorded; unsupported hidden reasoning is never inferred.

## Budgets and recovery

Local token counts are conservative UTF-8 byte estimates, not a tokenizer or billing count. The SDK currently exposes no supported tokenizer/preflight endpoint. Defaults reserve 2,000 tokens of headroom against the 32,000 single-question and 64,000 combined-question limits; long context is disabled. Both input limits and the estimator version are frozen. Questions can be batched against unchanged state; windows are never automatically resized, summarized or truncated. Oversized windows retain membership and no probability. Provider context rejections are permanent for the payload.

Preparation rejects sources above 128 MiB rather than silently omitting events. Metadata documents are bounded to 1 MiB; immutable source/request/response artifacts use Unicode-safe chunks. Preview inspection has its own response-size ceiling. These bounds are explicit operational limits, not claims that arbitrarily large traces fit memory.

Jobs have expiring leases, heartbeats and monotonically increasing fencing values. A replacement worker rejects stale writes and records abandoned attempts before retrying missing work. Cancellation and shutdown drain or cancel in-flight requests. SDK retries are disabled; the adapter owns the finite retry budget. A recovered network call may still incur duplicate provider cost even when local results deduplicate. Actual usage, when supplied, is recorded separately from local estimates.

`job.usage` aggregates provider attempts without counting the final response twice. `inputTokens` and `outputTokens` are null whenever their totals are incomplete; `knownInputTokens` and `knownOutputTokens` preserve known subtotals. `providerAttempts` and `unresolvedAttempts` expose coverage. These are reported usage values, not verified billing totals.

## Human review

`POST /api/jev/analyses/:id/reviews` accepts:

```json
{
  "scope": "window", "subjectId": "window ID", "codeId": "comply",
  "definitionRevision": "manifest.codebook.id",
  "evidenceRevision": "manifest.source.evidenceHash",
  "reviewer": "claimed reviewer name", "decision": "present",
  "rationale": "Why the evidence supports this judgment",
  "eventIds": [], "stepIds": [], "predictionsVisible": false,
  "expectedRevision": 0
}
```

For event scope, `subjectId` is the event ID. Evidence references must belong to the reviewed subject. Revisions append history and use optimistic conflict checks; predictions never change. Reviewer names are self-entered, not authenticated identities. Run-level reference outcomes belong to the independent oversight subsystem and require separate definition revisions and adjudication.

`POST /api/jev/analyses/:id/review-batches` accepts `{seed,randomSize,threshold,codeIds?,manualWindowIds?,mode}`. `mode` is `assisted` or `blind`. Selection unions flagged, seeded random and manual windows without duplicate tasks. Eligible population membership, population hash and all reasons are persisted. Paginated `GET /review-batches/:batchId?reviewer=...` hides score-derived reasons and threshold metadata until initial review; export retains full sampling provenance. Random selection does not make overlapping windows independent samples.

## Verification

From the repository root, run `npm run check`, `npm test`, and `npm run test:integration`. Tests cover the actual scripted harness fixture, historical-text deduplication, operation joins, report association, nested category filtering, fixed-window boundaries, malformed provider answers, exact SDK payloads, retries/cancellation/recovery, stale preview/revision checks, Unicode Mongo artifact round-trips, HTTP exports and frozen review queues.

A live one-window, one-code smoke passed on November 7, 2026 with returned model `jev-1.14.0`, one valid answer, and reported usage of 3,018 input / 22 output tokens. Its reproducible export is `data/exports/jev-live-2026-11-07T17-31-46.270Z.json`. Run `npm run smoke:jev --workspace=@sidechannel/integration` to repeat with a configured key; it creates and removes only its own temporary Mongo database and saves an export. This is a transport/persistence check against a scripted development fixture, not model-quality or calibration validation.
