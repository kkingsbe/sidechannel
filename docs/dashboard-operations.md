# Researcher dashboard operations

The React application is in `dashboard/`. Its API and static assets share one origin in production. The researcher API never executes an experiment or an analysis in the browser request lifecycle.

## Local development

Use Node 22.18+ on the 22.x line, or Node 24.11+. From the repository root:

```powershell
npm --prefix agent ci
npm --prefix dashboard ci
npm --prefix dashboard run build
```

Start MongoDB using the existing Compose service, then run these in separate terminals:

```powershell
npm --prefix agent run dashboard
npm --prefix agent run worker
npm --prefix agent run analysis:worker
```

Open `http://127.0.0.1:4310`. For UI development, `npm --prefix dashboard run dev` starts Vite and proxies `/api` to port 4310. Keep provider credentials in backend environment files. `TYPESAFE_API_KEY` is needed for Jev. The monitor uses its independently selected provider and that provider's server-side credentials. The scripted experiment fixture needs no model key.

The dashboard follows the system light/dark preference until a researcher selects an override. Display preferences never alter saved inference settings.

## Service ownership

| Service | Responsibility |
| --- | --- |
| Researcher API | Validate drafts; freeze and enqueue runs; manage research definitions, previews and jobs; serve the React build |
| Experiment worker | Execute the existing Mastra harness, one run at a time |
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

The fixture's artifact renderer is generic. A healthcare-specific evaluator is not supplied by this dashboard; scenario ground truth belongs to a separate researcher evaluation implementation.

## Exports and shared links

Run exports contain canonical evidence and frozen run configuration. Monitor exports contain the evaluation, frozen definitions, model settings, exact projections and per-view results. Their scope fields identify the dataset; they do not claim to include unrelated reviews or analyses. Shared URLs retain selected runs and evidence objects.

## Deployment

Compose builds from the repository root using `agent/Dockerfile`. The image includes `dashboard/dist`. Only the dashboard shares a network with the optional Cloudflare connector. The initial deployment is open: leave `RESEARCHER_TOKEN` blank and use the existing tunnel's single `http://dashboard:4310` application route for both UI and API. Inspect remote routing and any prior Access application before changing them. Database, worker and Mastra routes remain private.

External hostname configuration is account-owned and is not inferred from a local Compose file. A successful local build does not prove the public hostname is reachable.

## Verification

```powershell
npm --prefix agent run check
npm --prefix agent test
npm --prefix agent run test:mongo
npm --prefix dashboard test
npm --prefix dashboard run build
```

Routine tests use deterministic fixtures and injected provider transports, with no paid model calls. Mongo integration tests use isolated databases. Keep real research datasets and their existing named volume intact when rebuilding services.

For an interactive acceptance workspace, run `npm --prefix agent run dashboard:smoke` and open `http://127.0.0.1:4311`. It seeds an in-memory matched fixture pair, simulated analyses and oversight judgments. Every result is illustrative, explicitly marked scripted, and never a research finding. Restarting this smoke server resets its disposable data; it does not access MongoDB or a model provider.
