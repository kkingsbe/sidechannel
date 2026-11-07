# Sidechannel experiment harness

This implements the first milestone in `../harness_handoff.md`: configure and launch a synthetic experiment, execute fixed interleaved turns, inspect private memory and action evidence, and export the result. The healthcare protocol remains a later research decision.

## Run locally

Use Node **22.18+ (22.x)** or **24.11+**, npm, and Docker Desktop. Package versions and the MongoDB image digest are pinned. The supplied Node 24.7 installation passes our checks but emits engine warnings from the existing build dependencies.

From this directory:

```powershell
npm ci
npm --prefix ../dashboard ci
npm run dashboard:build
Copy-Item .env.example .env
docker compose up -d --wait mongo
npm run dashboard
```

Open <http://127.0.0.1:4310>. In a second terminal run:

```powershell
npm run worker
```

Validate the development fixture's resolved configuration, then launch it or a matched condition pair. The dashboard shows live state, full event payloads, board posts and explicit deliveries, memory before/after versions, artifact history, reports, and trace IDs. Closing the browser does not stop execution. The worker executes one run at a time. Draft edits cannot change launched snapshots.

The `scripted/fixture-v1` model needs no credentials. All agents in a live run share the selected provider/model/settings. Put provider credentials in the backend environment only; configuration contains settings, never keys. Verify the exact provider/model with the bundled Mastra skill's provider registry script. The React dashboard uses ordinary forms for prompts, model settings and numeric limits. Unsupported top-level model settings are rejected.

The initial shared deployment is open, as specified in `../docs/dashboard-spec.md`. Leave `RESEARCHER_TOKEN` blank and route the dashboard and `/api/*` through the same Cloudflare hostname. An optional API bearer token remains available for separate deployments; individual sign-in is not implemented. No Cloudflare resource or hostname is provisioned by the application.

## Adaption inference

Set `ADAPTION_API_KEY` in the repository-root `.env` or `agent/.env`. Local runtime scripts load both; `agent/.env` takes precedence, and existing process environment variables take precedence over either file. Both files are ignored by Git. Restart the worker after changing its environment.

In the dashboard set **Provider** to `adaption` and **Exact model** to `gemma-4-31b-it` (or another hosted model available to your key). In advanced configuration, a capped starting model configuration is:

```json
{
  "provider": "adaption",
  "id": "gemma-4-31b-it",
  "settings": { "temperature": 0, "maxOutputTokens": 512 }
}
```

Adaption uses Mastra's Responses transport at `https://api.prod.adaptionlabs.ai/api/v1`. The backend resolves credentials; keys never belong in run configuration. Direct hosted model IDs are required: stacks are rejected, response storage is disabled, and the harness owns history and executes all function tools. Existing one-step inference, zero retries, timeouts and evidence capture remain in force. Only `temperature` and `maxOutputTokens` are currently accepted for Adaption; other controls fail explicitly before inference.

Run `npm run smoke:live -- adaption gemma-4-31b-it` with MongoDB running to verify key-specific model access, inference, private memory and persisted Mastra traces. This makes one inference request, capped at 256 output tokens by default. `SMOKE_MODEL_SETTINGS` can override that cap and other settings. Adaption models are discovered through its authenticated catalog, not Mastra's bundled registry. See the [model catalog](https://docs.adaptionlabs.ai/inference-stacks/models/) for IDs and pricing.

For report prompts, explicitly request JSON without Markdown or code fences. The report parser remains strict; malformed reports are preserved as invalid evidence rather than silently repaired. Model behavior still needs pilots before study collection.

## Run separate containers

Compose supplies MongoDB, the dashboard/researcher API, the experiment worker, a separate analysis/monitor worker, and the Mastra Studio/API. Node, MongoDB and cloudflared images are version/digest pinned; npm uses lockfiles. The root build context includes the React dashboard build. The application image includes source and the lockfile for run provenance, and runs as the unprivileged `node` user.

From `agent/`, copy `.env.compose.example` to `.env.compose` once. Leave `RESEARCHER_TOKEN` blank for the initial open deployment. Set `OPENAI_API_KEY` or `ADAPTION_API_KEY` for inference and `TYPESAFE_API_KEY` for Jev; scripted experiments need no key. Keys are passed only to the relevant workers. The explicit `--env-file .env.compose` does not load the repository-root `.env`. Additional provider credentials can be supplied through a local Compose override; never put them in an image or saved configuration.

Stop any host dashboard or worker before replacing them with containers. An existing worker may own the database; starting another will fail rather than take over. Then run:

```powershell
docker compose --env-file .env.compose up -d --build --wait
docker compose --env-file .env.compose ps
docker compose --env-file .env.compose logs -f dashboard worker analysis-worker mastra
```

Open <http://127.0.0.1:4310>. Compose binds the server to `0.0.0.0` inside the container and supports the initial open mode. Host ports remain loopback only: dashboard `4310`, MongoDB `27018`, Mastra `4111`. Neither worker publishes a port. MongoDB is intended for the local Docker host; it is not part of the public route.

The existing named MongoDB volume (`sidechannel-harness-mongo`) is preserved. Container clients connect to `mongo:27017` with `directConnection=true`; host tools continue to use `127.0.0.1:27018`. This deliberately supports the existing single-node replica set's `localhost:27017` member without reconfiguring or erasing it. Do not remove the volume when updating containers. To run only the database for host development, use `docker compose up -d --wait mongo` as above.

Mastra is built with `npm run build -- --studio` and serves its Studio and API at <http://127.0.0.1:4111>. It loads the exported registry in `src/mastra/index.ts`. That registry is initially empty: experiment agents, tools, and trace storage are configured dynamically in the separate worker process. Studio does **not** discover that process or automatically display its agents or persisted traces. Use the researcher dashboard for run evidence and trace IDs. This container is a local Studio/API shell; shared live inspection would require a separate integration. No Mastra route is published through Cloudflare.

Rebuild after source/dependency changes with the same `up --build` command. The worker has no automatic restart policy. Before forced updates or shutdown, cancel active runs and allow inference to finish. Compose allows two minutes for graceful worker shutdown; a longer inference may be interrupted when that deadline expires. After a crash, stop **every** host/container worker and use:

```powershell
docker compose --env-file .env.compose stop worker
docker compose --env-file .env.compose run --rm --no-deps worker npm run recover -- --workers-stopped
docker compose --env-file .env.compose up -d worker
```

Recovery interrupts abandoned runs and clears ownership; it does not resume them. Use `docker compose --env-file .env.compose down` to stop/remove containers while retaining evidence. Never add `--volumes` unless deliberately deleting all stored research data.

## Optional dashboard-only Cloudflare Tunnel

The `tunnel` profile is disabled by default and needs no credentials for local operation. It adds a connector on a network shared only with the dashboard. It publishes no Docker ports, adds no WARP or subnet routes, and supplies no MongoDB browser UI. No Cloudflare resource or public hostname is provisioned by this repository.

Inspect the existing dedicated remotely managed tunnel in your Cloudflare account before changing its routes. The initial research deployment intentionally has no Cloudflare Access sign-in. If an older Access application protects the hostname, its configuration must be reconciled with that deployment decision. See Cloudflare's [published application routing](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/).

Configure exactly one published application route on that dedicated tunnel:

| Setting | Value |
| --- | --- |
| Public hostname | Your dashboard hostname |
| Path | All paths (UI, assets and `/api/*`) |
| Service | `http://dashboard:4310` |
| HTTP Host Header override | Leave unset, preserving the public Host for the API's same-origin check |

Keep MongoDB, Mastra, workers, and private-network routes off this tunnel. The dashboard and API share one origin; browser requests use relative `/api/*` URLs. In the initial open mode, no Access session or application token is required. Self-entered reviewer identities are claims, not verified accounts.

Save the tunnel token locally in `agent/secrets/cloudflare-tunnel-token.txt` (create the ignored `secrets` directory), or point `CLOUDFLARE_TUNNEL_TOKEN_FILE` in `.env.compose` at another protected local file. The file contains only the token string, not a credentials JSON document. Do not paste it into chat or commit it. Compose mounts the file as `/run/secrets/cloudflare_tunnel_token`; cloudflared uses its documented [`--token-file`](https://developers.cloudflare.com/tunnel/reference/run-parameters/) option. Local Compose secrets are host files, so restrict their filesystem permissions.

Once the hostname route has been inspected and configured:

```powershell
docker compose --env-file .env.compose --profile tunnel up -d cloudflared
docker compose --env-file .env.compose logs cloudflared
```

Verify that the dashboard and its API load without a sign-in, and that a shared run deep link survives refresh. External verification requires the actual hostname and account configuration. Stop only the connector with `docker compose --env-file .env.compose --profile tunnel stop cloudflared`; local services continue working. Keep the dedicated tunnel's route list limited to the dashboard.

## Checks and example evidence

```powershell
npm run check
npm test
npm run test:mongo
npm run build
```

Unit/API tests use scripted inference, including an actual Mastra Agent with a scripted V2 language model. Mongo integration requires the local replica set. It creates isolated databases and verifies idempotency, dashboard disconnection, six turns, persistent private memory, pairing, cancellation and export, then removes only its own databases.

To regenerate the saved example, stop the worker first:

```powershell
npm run fixture
```

`examples/completed-fixture.json` is a complete **scripted development run**, with frozen configuration, ordered payloads, board messages, artifact versions and private reports. It is not evidence of model-generated social behavior and has no provider-generated spans. Adapter tests separately exercise actual Mastra orchestration, persistence and native traces.

To include optional Mongo adapter tests:

```powershell
$env:TEST_MONGODB_URI='mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0'
npm test
```

For an actual model smoke test, configure its API key and run:

```powershell
npm run smoke:live -- <provider> <exact-model-id>
```

This verifies model availability (Adaption's live catalog or the installed provider registry), private memory persistence, the returned continuity marker and a real inference call with persisted trace correlation.

`npm run dev` and `npm run build` remain the Mastra Studio/build commands. The dashboard and worker have separate entry points. Runtime agents and proposal-only tools register through `src/mastra/index.ts`; starter shell, web and schedule tools remain unregistered.

## Design and evidence contracts

- `src/harness/contracts.ts` defines configuration, model, memory, scenario and repository interfaces. `config.ts` validates and resolves immutable snapshots, seeded order and condition pairs. Provenance records installed packages and a SHA-256 of source plus lockfile. Runs store a configuration hash; full prompt text and dataset assets remain in each snapshot.
- `scheduler.ts` owns rounds, tool allowance, model-step limits, reporting and terminal states. Requests are recorded before execution. Calls are admitted sequentially; each costs one action, including validation failures. Calls after exhaustion or yield receive unexecuted results.
- `gateway.ts` binds server-owned actor and operation identities, validates tools, records exact board deliveries and applies private-memory/scenario changes. Stable operation IDs deduplicate mutations. V1 infrastructure retries are explicitly zero; ambiguous writes interrupt execution.
- `mastra-adapter.ts` uses one-step inference with tool schemas having no execute function. Detached Mastra Memory stores lossless conversation envelopes and thread-scoped notes through the documented MongoDB adapter. Only the metered update tool changes notes. See `docs/mastra-integration.md`.
- `repository.ts` separates researcher collections from Mastra storage. Append-only events have schema version, ID, run ID, monotonic sequence, type, timestamp and applicable actor/turn/invocation/tool/operation IDs. Event IDs, per-run sequences and mutation operation IDs have unique indexes. Run documents are mutable projections.
- `server/index.ts` exposes validate/draft/run/pair/event/board/memory/artifact/report/cancel/export APIs. Pair launches use transactions, requiring a replica set. A persistent database-wide worker guard prevents cross-run concurrency.

Full history is persisted. V1 supplies that history until the configured **JSON character budget** is exceeded, then fails visibly instead of silently trimming. This is not a token estimate or Mastra's default message window. Optional recall and observational memory are off. Model events preserve input and output without assuming hidden reasoning is available.

The fixture exercises role-data reads, posting, explicit board reads, private notes, revision-checked contributions and yielding. Finalization copies the last artifact revision into a frozen revision after six turns. Each agent then receives exactly one separate reporting inference with no tools. Report schema v1 has exactly three string fields: `ownActions`, `observations`, `limitations`. Invalid reports remain raw missing data (`parsed: null`).

## Recovery and current limits

A crashed worker is never resumed automatically. Its persistent ownership guard blocks replacement workers. After confirming **all workers are stopped**, run:

```powershell
npm run recover -- --workers-stopped
```

This marks abandoned active runs interrupted and clears the guard; it never resumes them. Fresh launches get new identities. Ctrl+C requests cancellation at a safe boundary; in-flight inference may continue until its timeout.

The researcher dashboard now includes experiment forms, immutable matched launches, evidence inspection, codebooks, Jev analysis, human reviews and on-demand four-view oversight. Read the [dashboard operations guide](../docs/dashboard-operations.md) and [Jev backend guide](docs/jev-analysis.md) for the separate research worker and API contracts. The healthcare scenario, final study wording, model matrices, monetary cost caps, hosted identity integration and automatic experiment recovery remain separate work. Traces are persisted and correlated by ID; the dashboard exposes IDs and model payloads rather than a full span-tree viewer.

Run projections embed board/artifact/operation history and inherit MongoDB's 16 MB document limit. Larger studies need separate paginated projections before increasing limits. Evidence failure stops actions and attempts to mark interruption. If MongoDB itself is unavailable, that final write may also fail; the guard and manual recovery retain the incomplete run instead of claiming completion.
