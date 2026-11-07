# Sidechannel experiment harness

This implements the first milestone in `../harness_handoff.md`: configure and launch a synthetic experiment, execute fixed interleaved turns, inspect private memory and action evidence, and export the result. The healthcare protocol remains a later research decision.

## Run locally

Use Node **22.18+ (22.x)** or **24.11+**, npm, and Docker Desktop. Package versions and the MongoDB image digest are pinned. The supplied Node 24.7 installation passes our checks but emits engine warnings from the existing build dependencies.

From the repository root:

```powershell
npm ci
# First setup only; preserve existing configured environment files.
Copy-Item .env.example .env
docker compose up -d --wait mongo
npm run build
npm run dev:api
```

Open <http://127.0.0.1:4310>. In a second terminal run:

```powershell
npm run dev:experiment
```

Validate the development fixture's resolved configuration, then launch it or a matched condition pair. The dashboard shows live state, full event payloads, board posts and explicit deliveries, memory before/after versions, artifact history, reports, and trace IDs. Closing the browser does not stop execution. The worker executes one run at a time. Draft edits cannot change launched snapshots.

The `scripted/fixture-v1` model needs no credentials. All agents in a live run share the selected provider/model/settings. Put provider credentials in the backend environment only; configuration contains settings, never keys. Verify the exact provider/model with the bundled Mastra skill's provider registry script. The React dashboard uses ordinary forms for prompts, model settings and numeric limits. Unsupported top-level model settings are rejected.

The initial shared deployment is open, as specified in `dashboard-spec.md`. Leave `RESEARCHER_TOKEN` blank and route the dashboard and `/api/*` through the same Cloudflare hostname. An optional API bearer token remains available for separate deployments; individual sign-in is not implemented. No Cloudflare resource or hostname is provisioned by the application.

## Adaption inference

Set `ADAPTION_API_KEY` in the repository-root `.env` or `agent/.env`. Host commands load root `.env`, then the existing `agent/.env` compatibility file, then the owning service's `.env`; later files override earlier files, while existing process variables take precedence over every file. Workspace commands run with the service as their working directory. No file is copied or moved automatically. Both files are ignored by Git. Restart the worker after changing its environment.

In the dashboard set **Provider** to `adaption` and **Exact model** to `gemma-4-31b-it` (or another hosted model available to your key). In advanced configuration, a capped starting model configuration is:

```json
{
  "provider": "adaption",
  "id": "gemma-4-31b-it",
  "settings": { "temperature": 0, "maxOutputTokens": 512 }
}
```

Adaption uses Mastra's Responses transport at `https://api.prod.adaptionlabs.ai/api/v1`. The backend resolves credentials; keys never belong in run configuration. Direct hosted model IDs are required: stacks are rejected, response storage is disabled, and the harness owns history and executes all function tools. Existing one-step inference, zero retries, timeouts and evidence capture remain in force. Only `temperature` and `maxOutputTokens` are currently accepted for Adaption; other controls fail explicitly before inference.

Run `npm run smoke:live --workspace=@sidechannel/experiment-worker -- adaption gemma-4-31b-it` with MongoDB running to verify key-specific model access, inference, private memory and persisted Mastra traces. This makes one inference request, capped at 256 output tokens by default. `SMOKE_MODEL_SETTINGS` can override that cap and other settings. Adaption models are discovered through its authenticated catalog, not Mastra's bundled registry. See the [model catalog](https://docs.adaptionlabs.ai/inference-stacks/models/) for IDs and pricing.

For report prompts, explicitly request JSON without Markdown or code fences. The report parser remains strict; malformed reports are preserved as invalid evidence rather than silently repaired. Model behavior still needs pilots before study collection.

## Run separate containers

Root `compose.yaml` supplies MongoDB, the researcher API, and separate experiment and analysis/monitor workers. Optional `studio` and `tunnel` profiles enable Mastra Studio/API and Cloudflare. Each service has its own image and production dependency install. Images run compiled `dist/main.js` as the unprivileged `node` user, without Nx or tsx. The API image explicitly includes `/app/dashboard/dist`; workers contain no frontend assets. Shared compiled outputs include build provenance. Node, MongoDB and cloudflared images remain version/digest pinned; npm uses the single root workspace lockfile.

From the repository root, copy `.env.compose.example` to `.env.compose` once. Existing `agent/.env.compose` remains usable with `--env-file agent/.env.compose`; if its token override is `./secrets/...`, change that override to `./agent/secrets/...` because Compose paths now resolve from root. Do not copy or print real values while migrating. Leave `RESEARCHER_TOKEN` blank for the initial open deployment. Set `OPENAI_API_KEY` or `ADAPTION_API_KEY` for inference and `TYPESAFE_API_KEY` for Jev; scripted experiments need no key. Keys are passed only to the relevant workers. The explicit `--env-file .env.compose` does not load the repository-root `.env`. Additional provider credentials can be supplied through a local Compose override; never put them in an image or saved configuration.

Stop any host dashboard or worker before replacing them with containers. An existing worker may own the database; starting another will fail rather than take over. Then run:

```powershell
docker compose --env-file .env.compose up -d --build --wait
docker compose --env-file .env.compose ps
docker compose --env-file .env.compose logs -f api experiment-worker analysis-worker
```

Open <http://127.0.0.1:4310>. Compose binds the server to `0.0.0.0` inside the container and supports the initial open mode. Host ports remain loopback only: dashboard `4310`, MongoDB `27018`, Mastra `4111`. Neither worker publishes a port. MongoDB is intended for the local Docker host; it is not part of the public route.

The existing named MongoDB volume (`sidechannel-harness-mongo`) is preserved. Compose explicitly keeps project name `agent` and network names `agent_default`/`agent_tunnel`. The existing MongoDB container was observed on `agent_default`; the root network key remains `default` to preserve its Compose label as well as its name. If another deployment used a custom project or network name, inspect and match that identity in a local override before cutover. Stop the old `dashboard`/`worker` containers before bringing up the renamed `api`/`experiment-worker` services; do not leave an old worker attached. Avoid `--remove-orphans` until old services have been identified and stopped. Container clients connect to `mongo:27017` with `directConnection=true`; host tools continue to use `127.0.0.1:27018`. This deliberately supports the existing single-node replica set's `localhost:27017` member without reconfiguring or erasing it. Do not remove the volume when updating containers. To run only the database for host development, use `docker compose up -d --wait mongo` as above.

Enable Mastra with `docker compose --env-file .env.compose --profile studio up -d --build mastra`. It is built with `npm run build:studio --workspace=@sidechannel/experiment-worker` and serves its Studio and API at <http://127.0.0.1:4111>. It loads the exported registry in `experiment-worker/src/mastra/index.ts`. That registry is initially empty: experiment agents, tools, and trace storage are configured dynamically in the separate worker process. Studio does **not** discover that process or automatically display its agents or persisted traces. Use the researcher dashboard for run evidence and trace IDs. This container is a local Studio/API shell; shared live inspection would require a separate integration. No Mastra route is published through Cloudflare.

Rebuild after source/dependency changes with the same `up --build` command. The worker has no automatic restart policy. Before forced updates or shutdown, cancel active runs and allow inference to finish. Compose allows two minutes for graceful worker shutdown; a longer inference may be interrupted when that deadline expires. After a crash, stop **every** host/container worker and use:

```powershell
docker compose --env-file .env.compose stop experiment-worker
docker compose --env-file .env.compose run --rm --no-deps experiment-worker node dist/commands/recover.js --workers-stopped
docker compose --env-file .env.compose up -d experiment-worker
```

Recovery interrupts abandoned runs and clears ownership; it does not resume them. Use `docker compose --env-file .env.compose down` to stop/remove containers while retaining evidence. Never add `--volumes` unless deliberately deleting all stored research data.

### Published images (GHCR)

The [Docker publishing workflow](../.github/workflows/docker-publish.yml) builds separate API, experiment-worker, analysis-worker and optional Mastra images for Linux AMD64. MongoDB and cloudflared continue to use their pinned upstream images.

Pull requests targeting `main` build the image without publishing. Pushes to `main`, `v*` tags, and manual **Run workflow** executions publish `ghcr.io/kkingsbe/sidechannel-api`, `sidechannel-experiment-worker`, `sidechannel-analysis-worker` and `sidechannel-mastra` (forks use their repository name with the same service suffixes). Tags are:

- `main` and `latest` for builds of `main`.
- The exact Git tag, such as `v1.2.3`, for version-tag builds.
- The branch name for manual branch builds (normalized to a valid Docker tag).
- `sha-<full-commit-sha>` for every published build.

Only `main` updates `latest`. The workflow uses the built-in `GITHUB_TOKEN` with `packages: write`; no registry secret or provider API key is needed to build. If the package already exists, grant this repository Actions access in the package settings. See GitHub's [container registry authentication guidance](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-in-a-github-actions-workflow).

To use a published image, set `API_IMAGE`, `EXPERIMENT_WORKER_IMAGE`, `ANALYSIS_WORKER_IMAGE`, and optional `MASTRA_IMAGE` to their respective published image references in root `.env.compose`; use a version or commit SHA tag when selecting a specific build. For a private package, authenticate the deployment host using `docker login ghcr.io` with a token that can read the package. After stopping active experiments and existing workers as described above, run from the repository root:

```powershell
docker compose --env-file .env.compose up -d --no-build --pull always --wait
docker compose --env-file .env.compose ps
```

Keep `--no-build` when using registry images. To return to local builds, clear those image overrides and use the earlier `up --build` command. The workflow publishes images; it does not deploy or restart running services.

## Optional dashboard-only Cloudflare Tunnel

The `tunnel` profile is disabled by default and needs no credentials for local operation. It adds a connector on a network shared only with the dashboard. It publishes no Docker ports, adds no WARP or subnet routes, and supplies no MongoDB browser UI. No Cloudflare resource or public hostname is provisioned by this repository.

Inspect the existing dedicated remotely managed tunnel in your Cloudflare account before changing its routes. The initial research deployment intentionally has no Cloudflare Access sign-in. If an older Access application protects the hostname, its configuration must be reconciled with that deployment decision. See Cloudflare's [published application routing](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/).

Configure exactly one published application route on that dedicated tunnel:

| Setting | Value |
| --- | --- |
| Public hostname | Your dashboard hostname |
| Path | All paths (UI, assets and `/api/*`) |
| Service | `http://api:4310` (the existing `http://dashboard:4310` alias remains available during cutover) |
| HTTP Host Header override | Leave unset, preserving the public Host for the API's same-origin check |

Keep MongoDB, Mastra, workers, and private-network routes off this tunnel. The dashboard and API share one origin; browser requests use relative `/api/*` URLs. In the initial open mode, no Access session or application token is required. Self-entered reviewer identities are claims, not verified accounts.

Save the tunnel token locally in `agent/secrets/cloudflare-tunnel-token.txt` (create the ignored `secrets` directory), or point `CLOUDFLARE_TUNNEL_TOKEN_FILE` in root `.env.compose` at another protected local file. The file contains only the token string, not a credentials JSON document. Do not paste it into chat or commit it. Compose mounts the file as `/run/secrets/cloudflare_tunnel_token`; cloudflared uses its documented [`--token-file`](https://developers.cloudflare.com/tunnel/reference/run-parameters/) option. Local Compose secrets are host files, so restrict their filesystem permissions.

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
npm run test:integration
npm run build
```

Unit/API tests use scripted inference, including an actual Mastra Agent with a scripted V2 language model. Mongo integration requires the local replica set. It creates isolated databases and verifies idempotency, dashboard disconnection, six turns, persistent private memory, pairing, cancellation and export, then removes only its own databases.

To regenerate the saved example, stop the worker first:

```powershell
npm run fixture --workspace=@sidechannel/experiment-worker
```

`agent/examples/completed-fixture.json` is a complete **scripted development run**, with frozen configuration, ordered payloads, board messages, artifact versions and private reports. It is not evidence of model-generated social behavior and has no provider-generated spans. Adapter tests separately exercise actual Mastra orchestration, persistence and native traces.

To include optional Mongo adapter tests:

```powershell
$env:TEST_MONGODB_URI='mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0'
npm test
```

For an actual model smoke test, configure its API key and run:

```powershell
npm run smoke:live --workspace=@sidechannel/experiment-worker -- <provider> <exact-model-id>
```

This verifies model availability (Adaption's live catalog or the installed provider registry), private memory persistence, the returned continuity marker and a real inference call with persisted trace correlation.

`npm run studio --workspace=@sidechannel/experiment-worker` and `npm run build:studio --workspace=@sidechannel/experiment-worker` preserve optional Mastra tooling. `npm run build` at root builds the workspace applications and shared packages through Nx. Runtime agents and proposal-only tools register through `experiment-worker/src/mastra/index.ts`; starter shell, web and schedule tools remain unregistered.

## Design and evidence contracts

- `packages/contracts` provides public DTOs and server ports. Frontend consumers use only `@sidechannel/contracts/browser`; test fixtures use the test-only `@sidechannel/contracts/testing` export.
- `packages/domain` owns immutable configuration resolution, scenario initialization, question construction, evidence normalization, projections and review rules. Build provenance is generated with the compiled shared outputs.
- `packages/persistence` owns MongoDB repositories, indexes, transactions, the experiment guard and independently leased research jobs.
- `experiment-worker/src/harness` owns scheduling, the action gateway, provider/memory adapters and terminal states. Requests are recorded before execution. Stable operation IDs deduplicate mutations; ambiguous writes interrupt execution.
- `api/src` owns HTTP routes and static hosting; `DASHBOARD_DIST_DIR` explicitly identifies the built assets. Pair launches use transactions and require a replica set.
- `analysis-worker/src` owns Jev and direct-monitor provider execution. The API and shared preparation services never require live provider credentials.

Full history is persisted. V1 supplies that history until the configured **JSON character budget** is exceeded, then fails visibly instead of silently trimming. This is not a token estimate or Mastra's default message window. Optional recall and observational memory are off. Model events preserve input and output without assuming hidden reasoning is available.

The fixture exercises role-data reads, posting, explicit board reads, private notes, revision-checked contributions and yielding. Finalization copies the last artifact revision into a frozen revision after six turns. Each agent then receives exactly one separate reporting inference with no tools. Report schema v1 has exactly three string fields: `ownActions`, `observations`, `limitations`. Invalid reports remain raw missing data (`parsed: null`).

## Recovery and current limits

A crashed worker is never resumed automatically. Its persistent ownership guard blocks replacement workers. After confirming **all workers are stopped**, run:

```powershell
npm run recover --workspace=@sidechannel/experiment-worker -- --workers-stopped
```

This marks abandoned active runs interrupted and clears the guard; it never resumes them. Fresh launches get new identities. Ctrl+C requests cancellation at a safe boundary; in-flight inference may continue until its timeout.

The researcher dashboard now includes experiment forms, immutable matched launches, evidence inspection, codebooks, Jev analysis, human reviews and on-demand four-view oversight. Read the [dashboard operations guide](dashboard-operations.md) and [Jev backend guide](jev-analysis.md) for the separate research worker and API contracts. The healthcare scenario, final study wording, model matrices, monetary cost caps, hosted identity integration and automatic experiment recovery remain separate work. Traces are persisted and correlated by ID; the dashboard exposes IDs and model payloads rather than a full span-tree viewer.

Run projections embed board/artifact/operation history and inherit MongoDB's 16 MB document limit. Larger studies need separate paginated projections before increasing limits. Evidence failure stops actions and attempts to mark interruption. If MongoDB itself is unavailable, that final write may also fail; the guard and manual recovery retain the incomplete run instead of claiming completion.
