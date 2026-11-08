# Sidechannel experiment harness

This implements the first milestone in `../harness_handoff.md`: configure and launch a synthetic experiment, execute fixed interleaved turns, inspect private memory and action evidence, and export the result. The healthcare points runtime, catalog and dashboard smoke path are documented in [Healthcare readiness results](healthcare-smoke-results.md), including bootstrap commands, scripted evidence and the remaining live walkthrough.

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

Report prompts should tell the agent to call `submit_report`. Validation remains strict; invalid submissions are retried only within `reportCalls`, and reports are preserved as invalid evidence rather than silently repaired. Model behavior still needs pilots before study collection.

## Run separate containers

Root `compose.yaml` supplies MongoDB, the researcher API, and separate experiment and analysis/monitor workers. Optional `studio` and `tunnel` profiles enable Mastra Studio/API and Cloudflare. Each service has its own image and production dependency install. Images run compiled `dist/main.js` as the unprivileged `node` user, without Nx or tsx. The API image explicitly includes `/app/dashboard/dist`; workers contain no frontend assets. Shared compiled outputs include build provenance. Node, MongoDB and cloudflared images remain version/digest pinned; npm uses the single root workspace lockfile.

From the repository root, copy `.env.compose.example` to `.env.compose` once. Existing `agent/.env.compose` remains usable with `--env-file agent/.env.compose`; if its token override is `./secrets/...`, change that override to `./agent/secrets/...` because Compose paths now resolve from root. Do not copy or print real values while migrating. Leave `RESEARCHER_TOKEN` blank for the initial open deployment. Set `OPENAI_API_KEY` or `ADAPTION_API_KEY` for inference and `TYPESAFE_API_KEY` for Jev; scripted experiments need no key. Keys are passed only to the relevant backend services; Adaption model discovery also requires the key on the API. The explicit `--env-file .env.compose` does not load the repository-root `.env`. Additional provider credentials can be supplied through a local Compose override; never put them in an image or saved configuration.

Stop any host dashboard or worker before replacing them with containers. An existing worker may own the database; starting another will fail rather than take over. Then run:

```powershell
docker compose --env-file .env.compose up -d --build --wait
docker compose --env-file .env.compose ps
docker compose --env-file .env.compose logs -f api experiment-worker analysis-worker
```

Open <http://127.0.0.1:4310>. Compose binds the server to `0.0.0.0` inside the container and supports the initial open mode. Host ports remain loopback only: dashboard `4310`, MongoDB `27018`, Mastra `4111`. Neither worker publishes a port. MongoDB is intended for the local Docker host; it is not part of the public route.

The existing named MongoDB volume (`sidechannel-harness-mongo`) is preserved. Compose explicitly keeps project name `agent` and network names `agent_default`/`agent_tunnel`. The existing MongoDB container was observed on `agent_default`; the root network key remains `default` to preserve its Compose label as well as its name. If another deployment used a custom project or network name, inspect and match that identity in a local override before cutover. Stop the old `dashboard`/`worker` containers before bringing up the renamed `api`/`experiment-worker` services; do not leave an old worker attached. Avoid `--remove-orphans` until old services have been identified and stopped. Container clients connect to `mongo:27017` with `directConnection=true`; host tools continue to use `127.0.0.1:27018`. This deliberately supports the existing single-node replica set's `localhost:27017` member without reconfiguring or erasing it. Do not remove the volume when updating containers. To run only the database for host development, use `docker compose up -d --wait mongo` as above.

Enable Mastra with `docker compose --env-file .env.compose --profile studio up -d --build mastra`. It is built with `npm run build:studio --workspace=@sidechannel/experiment-worker` and serves its Studio and API at <http://127.0.0.1:4111>. It loads the exported registry in `experiment-worker/src/mastra/index.ts`. That registry is initially empty: experiment agents, tools, and trace storage are configured dynamically in the separate worker process. Studio does **not** discover that process or automatically display its agents or persisted traces. Use the researcher dashboard for run evidence and trace IDs. This container is a local Studio/API shell; shared live inspection would require a separate integration. No Mastra route is published through Cloudflare.

Rebuild after source/dependency changes with the same `up --build` command. The worker restarts automatically (`unless-stopped`). Before forced updates or shutdown, cancel active runs and allow inference to finish. Compose allows two minutes for graceful worker shutdown; a longer inference may be interrupted when that deadline expires. A crashed or killed worker needs no manual step: its lease expires (see [Recovery](#recovery-and-current-limits)) and the restarted worker interrupts the abandoned run. To clear the lease immediately instead of waiting, stop **every** host/container worker and use:

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

### Portainer stack

For a fresh **Docker Standalone, Linux AMD64** deployment, paste [compose.portainer.yaml](../compose.portainer.yaml) into Portainer's **Stacks → Add stack → Web editor**. This file pulls GHCR images without a source checkout, build contexts, or host secret files. It includes MongoDB, the dashboard/API, both workers, an image updater, and Cloudflare Tunnel; optional Mastra Studio is not included.

Set `OPENAI_API_KEY` and/or `ADAPTION_API_KEY` in the stack's environment variables for live inference, and `TYPESAFE_API_KEY` for Jev analysis. Scripted fixtures require no provider keys. Set `UPDATER_ADMIN_PASSWORD` (and optionally `UPDATER_ADMIN_USER`, default `admin`): the WUD 9 image updater exits at startup without an administrator account, which silently stops automatic updates. `IMAGE_TAG` defaults to `latest`; set it to a published version or `sha-<full-commit>` to pin all three application images to one build. The publishing workflow must have successfully published that tag. Private GHCR packages require registry credentials with package read access in Portainer.

Open `http://<docker-host>:4310` after deployment. `DASHBOARD_PORT` can change the host port; `DASHBOARD_BIND_ADDRESS` defaults to `0.0.0.0`. The dashboard follows the initial open deployment configuration (`RESEARCHER_TOKEN` is blank), so anyone who can reach that port can use it. MongoDB has no published host port. This stack creates a new stack-scoped `mongo-data` volume and does not copy the development database. Keep the stack name and volume when updating, and cancel active experiments before redeploying workers.

Every service has a memory limit so that one container cannot exhaust the host; without limits, memory pressure during a live run or an image update took the API and the Cloudflare connector offline. Defaults total about 3.4 GB. Override them in the stack's environment variables to fit the host:

| Service | Memory limit variable (default) | Related setting (default) |
| --- | --- | --- |
| MongoDB | `MONGO_MEMORY_LIMIT` (`1g`) | `MONGO_CACHE_GB` (`0.5`), WiredTiger cache; keep at or below half the limit |
| API | `API_MEMORY_LIMIT` (`512m`) | `API_NODE_HEAP_MB` (`384`) |
| Experiment worker | `EXPERIMENT_WORKER_MEMORY_LIMIT` (`1g`) | `EXPERIMENT_WORKER_NODE_HEAP_MB` (`768`) |
| Analysis worker | `ANALYSIS_WORKER_MEMORY_LIMIT` (`512m`) | `ANALYSIS_WORKER_NODE_HEAP_MB` (`384`) |
| Cloudflare connector | `CLOUDFLARED_MEMORY_LIMIT` (`128m`) | |
| Image updater | `UPDATER_MEMORY_LIMIT` (`256m`) | |

Keep each Node heap about 75% of its container limit so garbage collection runs before the kernel kills the container. Leave headroom on the host for image pulls during automatic updates.

Automatic updates never replace a busy worker. Each worker carries a WUD pre-update hook that runs `dist/commands/update-guard.js` inside the current container; it exits non-zero while experiment runs are queued, running, reporting or stopping (experiment worker), or while Jev analysis or oversight jobs are preparing, queued or running (analysis worker), and when it cannot reach MongoDB. A failing pre-update hook makes the updater skip the update and leave the container running; with `ONCE=false` the update is retried on each check until the worker is idle. The API is not guarded: replacing it briefly interrupts the dashboard but not runs. Look for `update-guard: deferring update` in the updater's logs.

The hook executes in the container being replaced, so the running image must already contain the guard. When adopting these labels, first let the publishing workflow build an image that includes `update-guard.js`, then paste the updated stack file and redeploy with **Re-pull image** so the guarded images are running. An older worker without the guard fails the hook and blocks its own automatic updates until it is redeployed manually.

#### Cloudflare Tunnel in Portainer

Set `CLOUDFLARE_TUNNEL_TOKEN` in the same Portainer stack environment variables. Use the token from the dedicated remotely managed tunnel's connector installation command (the value after `--token`, not the whole command or a Cloudflare API token). Compose passes it to cloudflared as `TUNNEL_TOKEN`; no local secret file is needed. See [Cloudflare tunnel tokens](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/).

In that tunnel's published application routes, map your public hostname to **HTTP**, service **`api:4310`**. Leave the path and HTTP Host Header override unset so the dashboard and `/api/*` share one origin. The compatibility origin `http://dashboard:4310` also works. Only the API and connector share the `tunnel` network. The connector is version/digest pinned and excluded from automatic updates. If access should go only through the tunnel, set `DASHBOARD_BIND_ADDRESS=127.0.0.1` to restrict the separate host port. For a deployment without Cloudflare, remove the `cloudflared` service before deploying; otherwise Compose requires its token.

#### Automatic image updates

The Portainer Compose includes [WUD](https://getwud.app/docs/configuration/triggers/docker/), pinned to `9.7.0`. It checks GHCR at startup and every five minutes (plus scheduler jitter), pulls changed image digests, and recreates the API and running workers with their existing configuration. It keeps the selected `IMAGE_TAG`: `latest` follows new main builds, while a commit tag remains on that commit. MongoDB, the updater itself, and unrelated containers are not opted into this update trigger. Stopped or crashed experiment workers are not automatically revived. WUD uses the Docker socket, which grants control of the host's containers; its UI is not published and it uses a separate network.

Set `AUTO_UPDATE_CRON` to change the polling schedule (default `*/5 * * * *`). Set `AUTO_UPDATE_ENABLED=false` and redeploy to keep polling without automatic replacements, or stop `image-updater` in Portainer to pause immediately. Check that service's logs for detected updates and failures. Old images are retained. Private packages require the two commented `WUD_REGISTRY_GHCR_PRIVATE_*` environment lines to be uncommented and `GHCR_USERNAME` / `GHCR_TOKEN` supplied in Portainer; use a token with `read:packages`. Portainer registry credentials alone do not authenticate WUD. See [WUD GHCR authentication](https://getwud.app/docs/configuration/registries/ghcr/).

**Updates can cancel an active experiment.** The worker requests cancellation on SIGTERM; it does not drain an entire run before exiting. Its existing two-minute stop grace period remains configured; after a forced stop the replacement worker waits for the old lease to expire (30 s by default) and marks the cut-off run interrupted. Pause the updater during experiments that must finish uninterrupted. Updates replace individual containers, not an atomic release of the whole stack: the publishing workflow builds each service independently, so mixed versions can occur during publication and replacement. Compose/configuration changes still require editing and redeploying the Portainer stack.

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

The fixture exercises role-data reads, posting, explicit board reads, private notes, revision-checked contributions and yielding. Finalization copies the last artifact revision into a frozen revision after six turns. Each agent then receives a separate reporting phase with one tool, `submit_report`, taking exactly three non-empty string fields: `ownActions`, `observations`, `limitations` (report schema version `2`). `limits.reportCalls` (1 to 5) is the retry budget for invalid or missing submissions; other tools in that phase are `tool_unexecuted`. If no valid call is made the report remains raw missing data (`parsed: null`).

## Recovery and current limits

One experiment worker runs at a time. It holds a lease in `worker_guard` and renews it every third of `WORKER_LEASE_MS` (default 30 s, minimum 3 s), timed by the MongoDB server clock. A second worker logs that it is waiting and polls rather than exiting. A worker that crashes on an uncaught error releases the lease before exiting. A killed, OOM-terminated or hung worker stops renewing, and once its lease is a full period old the next worker takes it over. Guards written before heartbeats existed count as expired. The worker that takes the lease marks every `running`/`reporting`/`stopping` run **interrupted** before it starts work; runs are never resumed. A worker that loses its lease (taken over, or renewal failing for a full period) exits immediately rather than writing alongside its replacement. The dashboard overview reports the worker available only while its heartbeat is current.

To clear the lease without waiting for it to expire, confirm **all workers are stopped**, then run:

```powershell
npm run recover --workspace=@sidechannel/experiment-worker -- --workers-stopped
```

This marks abandoned active runs interrupted and clears the guard; it never resumes them. Fresh launches get new identities. Ctrl+C requests cancellation at a safe boundary; in-flight inference may continue until its timeout.

The researcher dashboard now includes experiment forms, immutable matched launches, evidence inspection, codebooks, Jev analysis, human reviews and on-demand four-view oversight. Read the [dashboard operations guide](dashboard-operations.md) and [Jev backend guide](jev-analysis.md) for the separate research worker and API contracts. The healthcare scenario, final study wording, model matrices, monetary cost caps, hosted identity integration and automatic experiment recovery remain separate work. Traces are persisted and correlated by ID; the dashboard exposes IDs and model payloads rather than a full span-tree viewer.

Run projections embed board/artifact/operation history and inherit MongoDB's 16 MB document limit. Larger studies need separate paginated projections before increasing limits. Evidence failure stops actions and attempts to mark interruption. If MongoDB itself is unavailable, that final write may also fail; the run stays active until the next worker to take the lease marks it interrupted, rather than being reported complete.
