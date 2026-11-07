# Sidechannel experiment harness

This implements the first milestone in `../harness_handoff.md`: configure and launch a synthetic experiment, execute fixed interleaved turns, inspect private memory and action evidence, and export the result. The healthcare protocol remains a later research decision.

## Run locally

Use Node **22.18+ (22.x)** or **24.11+**, npm, and Docker Desktop. Package versions and the MongoDB image digest are pinned. The supplied Node 24.7 installation passes our checks but emits engine warnings from the existing build dependencies.

From this directory:

```powershell
npm ci
Copy-Item .env.example .env
docker compose up -d --wait mongo
npm run dashboard
```

Open <http://127.0.0.1:4310>. In a second terminal run:

```powershell
npm run worker
```

Validate the development fixture's resolved configuration, then launch it or a matched condition pair. The dashboard shows live state, full event payloads, board posts and explicit deliveries, memory before/after versions, artifact history, reports, and trace IDs. Closing the browser does not stop execution. The worker executes one run at a time. Draft edits cannot change launched snapshots.

The `scripted/fixture-v1` model needs no credentials. All agents in a live run share the selected provider/model/settings. Put provider credentials in the backend environment only; configuration JSON contains settings, never keys. Verify the exact provider/model with the bundled Mastra skill's provider registry script. The advanced JSON editor supports versioned prompts, model settings and numeric limits. Unsupported top-level model settings are rejected.

For shared deployment, set `HARNESS_HOST`, supply `RESEARCHER_TOKEN`, and terminate TLS at your existing authenticated team proxy. The dashboard sends its token in an Authorization header. No hosted deployment or identity provider is provisioned here.

## Run separate containers

Compose supplies MongoDB, the dashboard/researcher API, one worker, and the Mastra Studio/API as separate services. Node, MongoDB and cloudflared images are version/digest pinned; npm uses the lockfile. The shared application image includes source and the lockfile for run provenance, and runs as the unprivileged `node` user.

From `agent/`, copy `.env.compose.example` to `.env.compose` once. Set `RESEARCHER_TOKEN` to a long random secret (for example generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`). Keep it in the ignored file. Set `OPENAI_API_KEY` there only if using OpenAI models; scripted runs require no provider key. Other providers can be added explicitly to the worker's environment in a local Compose override; never put credentials in an image or run configuration.

Stop any host dashboard or worker before replacing them with containers. An existing worker may own the database; starting another will fail rather than take over. Then run:

```powershell
docker compose --env-file .env.compose up -d --build --wait
docker compose --env-file .env.compose ps
docker compose --env-file .env.compose logs -f dashboard worker mastra
```

Open <http://127.0.0.1:4310> and enter the researcher token in the dashboard token field. Compose deliberately binds the server to `0.0.0.0` inside the container; the application refuses to start without a token. Host ports remain loopback only: dashboard `4310`, MongoDB `27018`, Mastra `4111`. The worker publishes no port. MongoDB is unauthenticated and intended for this trusted local Docker host, so do not change its mapping to a public interface.

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

Before starting it, configure a **dedicated remotely managed tunnel** in your Cloudflare account and an Access self-hosted application for your chosen dashboard hostname. Configure an explicit Allow policy limited to the intended researchers, without Bypass or broad public Allow rules. Create/verify that policy **before** publishing the route. See Cloudflare's [tunnel setup](https://developers.cloudflare.com/tunnel/get-started/) and [Access application setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/).

Configure exactly one published application route on that dedicated tunnel:

| Setting | Value |
| --- | --- |
| Public hostname | Your Access-protected dashboard hostname |
| Path | All paths (UI, assets and `/api/*`) |
| Service | `http://dashboard:4310` |
| HTTP Host Header override | Leave unset, preserving the public Host for the API's same-origin check |

Do not add MongoDB, Mastra, private-network, or wildcard service routes. Access controls user access; the application still requires its researcher bearer token. After Access login, enter that token in the dashboard UI. Browser API requests carry both the Access session and the existing Authorization header; no application authentication bypass is introduced.

Save the tunnel token locally in `agent/secrets/cloudflare-tunnel-token.txt` (create the ignored `secrets` directory), or point `CLOUDFLARE_TUNNEL_TOKEN_FILE` in `.env.compose` at another protected local file. The file contains only the token string, not a credentials JSON document. Do not paste it into chat or commit it. Compose mounts the file as `/run/secrets/cloudflare_tunnel_token`; cloudflared uses its documented [`--token-file`](https://developers.cloudflare.com/tunnel/reference/run-parameters/) option. Local Compose secrets are host files, so restrict their filesystem permissions.

Once the hostname route and Access policy are reviewed and configured:

```powershell
docker compose --env-file .env.compose --profile tunnel up -d cloudflared
docker compose --env-file .env.compose logs cloudflared
```

Verify that an unauthenticated browser receives the Access login/denial before the dashboard, an allowed researcher can load the UI and make a token-authenticated API request, and an unauthorized identity is denied. This external end-to-end check requires your actual domain, account and policy. Stop only the connector with `docker compose --env-file .env.compose --profile tunnel stop cloudflared`; local services continue working. A tunnel token permits the remotely configured routes, so keep this dedicated tunnel's route list limited to the dashboard.

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

This verifies the installed model registry, private memory persistence and a real inference call. No live smoke was possible during implementation because no provider key was configured.

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

Implemented scope is the fixture, basic shared-token access, action/duration limits and evidence/export. The healthcare scenario, final study prompts, model matrix execution, monetary cost caps, monitor views, semantic evaluation, hosted identity integration and automatic recovery remain outside this first milestone. Traces are persisted and correlated by ID; the dashboard exposes IDs and model payloads rather than a full span-tree viewer.

Run projections embed board/artifact/operation history and inherit MongoDB's 16 MB document limit. Larger studies need separate paginated projections before increasing limits. Evidence failure stops actions and attempts to mark interruption. If MongoDB itself is unavailable, that final write may also fail; the guard and manual recovery retain the incomplete run instead of claiming completion.
