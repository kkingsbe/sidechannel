# Researcher dashboard operations

The React application is in `dashboard/`. Its API and static assets share one origin in production. The researcher API never executes an experiment or an analysis in the browser request lifecycle.

## Local development

Use Node 22.18+ on the 22.x line, or Node 24.11+. From the repository root:

```powershell
npm ci
npm run build
docker compose up -d --wait mongo
```

Start MongoDB using the existing Compose service, then run these in separate terminals:

```powershell
npm run dev:api
npm run dev:experiment
npm run dev:analysis
```

Open `http://127.0.0.1:4310`. For UI development, `npm run dev:dashboard` starts Vite and proxies `/api` to port 4310. Keep provider credentials in backend environment files. `TYPESAFE_API_KEY` is needed for Jev. The monitor uses its independently selected provider and that provider's server-side credentials. The scripted experiment fixture needs no model key.

The dashboard follows the system light/dark preference until a researcher selects an override. Display preferences never alter saved inference settings.

## Service ownership

| Service | Responsibility |
| --- | --- |
| Researcher API | Validate drafts; freeze and enqueue runs; manage research definitions, previews and jobs; serve the React build |
| Experiment worker | Execute the existing Mastra harness, up to four runs in parallel (`WORKER_CONCURRENCY`) |
| Analysis/monitor worker | Independently leased Jev and direct oversight work |
| MongoDB | Canonical run evidence plus separate research records |

Closing or reloading the dashboard does not cancel work. Experiment cancellation distinguishes requested/stopping from terminal cancellation. Monitor cancellation takes effect between isolated view invocations; a current request may finish before the remaining views are cancelled.

## Oversight workflow

1. Edit monitor questions and outcome definitions through the Oversight forms. Saving creates an immutable revision and rejects a stale revision.
2. Select completed runs and an independent provider/model. Set context capacity, output allowance and input-character ceiling for that model.
3. Preview the exact four projections. Input budgeting includes instructions and outcome definitions, uses a conservative UTF-8-byte token estimate, and reserves the output allowance. Oversized views remain visible and are never truncated.
4. Launch the preview with a stable request key. A changed definition or changed source evidence rejects launch and requires another preview.
5. Inspect per-view outcomes and citations. An invalid citation, malformed response or provider error is a failed view. It is never converted into an absent finding. A comparison with any missing view is partial.

Reports, audit metadata, board evidence and full trace are progressively broader views. Audit metadata uses explicit fields, excluding arbitrary nested payloads and error text. Full trace includes recorded private memory and explicitly supported observable reasoning parts. It never claims access to unrecorded hidden reasoning. Research labels, answer-key containers, Jev predictions and other monitor outputs are not input sources.

The healthcare artifact renderer shows ranked entries and frozen versions. Its separate researcher evaluation reports structural completion and approved/full-information ranking utility; those results and ground truth are excluded from Jev and oversight inputs.

## Archiving and deleting runs

Recorded evidence is append-only, but a finished run that is only clutter (for example one a worker crash left `interrupted`) can be cleared. Only completed, failed, cancelled and interrupted runs qualify; queued, running, reporting and stopping runs belong to the experiment worker and are refused with a 409.

- **Archive** is reversible. An archived run disappears from the Runs list, the Overview counts and "Needs attention", but stays reachable by its ID and keeps its launch key, so relaunching the same `idempotencyKey` returns the archived run rather than a new one. Use the Runs filter "Archived" (hide, show, only) to find archived runs, then **Unarchive** them.
- **Delete** is permanent and frees the launch key. It removes the run and its events, counters, operations, healthcare evaluator reference and evaluations, and the worker's private Mastra memory and model traces. It is refused with a 409 that lists the dependents while any Jev analysis, Jev run review, human outcome review or monitor evaluation cites the run; archive such a run instead.
- Select several finished runs in the Runs list (Runs view) for bulk Archive or Delete. Deletion always asks for confirmation, naming each run and stating that it cannot be undone. Each run is reported separately, so a refused run never blocks the rest.
- From a run's detail page, finished runs offer Archive/Unarchive and Delete in the header.

## Exports and shared links

Run exports contain canonical evidence and frozen run configuration. Monitor exports contain the evaluation, frozen definitions, model settings, exact projections and per-view results. Their scope fields identify the dataset; they do not claim to include unrelated reviews or analyses. Shared URLs retain selected runs and evidence objects.

## Deployment

Root `compose.yaml` builds separate API, experiment-worker and analysis-worker images from their service Dockerfiles. Each runs its compiled Node entry point with its own production dependencies. The API image includes `/app/dashboard/dist` and explicitly sets `DASHBOARD_DIST_DIR`; worker images do not contain dashboard assets. Only the API/static host shares a network with the optional Cloudflare connector. The initial deployment is open: leave `RESEARCHER_TOKEN` blank and use the existing tunnel's single `http://api:4310` (the existing `dashboard` network alias remains valid during cutover) application route for both UI and API. Inspect remote routing and any prior Access application before changing them. Database, worker and Mastra routes remain private.

External hostname configuration is account-owned and is not inferred from a local Compose file. A successful local build does not prove the public hostname is reachable.

## Verification

```powershell
npm run check
npm test
npm run test:integration
npm run lint
npm run build
```

Routine tests use deterministic fixtures and injected provider transports, with no paid model calls. Mongo integration tests use isolated databases. Keep real research datasets and their existing named volume intact when rebuilding services.

For an interactive acceptance workspace, run `npm run smoke:dashboard --workspace=@sidechannel/integration` and open `http://127.0.0.1:4311`. It seeds an in-memory matched fixture pair, simulated analyses and oversight judgments. Every result is illustrative, explicitly marked scripted, and never a research finding. Restarting this smoke server resets its disposable data; it does not access MongoDB or a model provider.

Root workspace commands delegate to Nx for dependency-ordered builds and checks. Host services load root `.env`, then the service `.env`; process variables take precedence. Compose uses its explicitly selected `--env-file .env.compose` instead. See [harness operations](harness-operations.md) for per-service credentials, optional Studio, manual recovery, existing-volume reuse and deployment cutover. A replacement experiment worker waits until the old worker's lease is released or expires; it never runs alongside it.

The current local deployment uses project `agent` and explicitly loads root `.env` for service preparation: `docker compose --env-file .env -p agent ...`. Use the environment file actually populated for the deployment; `.env.compose` is an alternative, not an automatically loaded file. Starting the missing analysis worker only requires `docker compose --env-file .env -p agent up -d --no-deps analysis-worker`; do not recreate the experiment worker or MongoDB for this operation. See [current live-service preparation](archive/2026-11-07-live-services-readiness.md).
