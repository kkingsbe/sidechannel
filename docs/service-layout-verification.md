# Service layout migration verification

Implemented November 7, 2026 from [the migration specification](service-layout-migration.md).

## Delivered layout

- `api`, `experiment-worker`, `analysis-worker`, and `dashboard` are npm workspaces with independent build and runtime commands.
- `packages/contracts`, `packages/domain`, and `packages/persistence` provide explicit built ESM exports and declarations. The browser entry exports DTO types only; fixture support has a separate test-only export.
- Nx 23.3.1 manages eight projects, including the cross-service test workspace. Service dependencies point to shared packages, with no service-to-service or shared-to-service source edges.
- One root lockfile replaces the former backend and dashboard lockfiles. Existing direct dependencies and provider SDK versions were preserved. Backend TypeScript remains 6.0.3 and dashboard TypeScript remains 5.9.3.
- `agent/` retains historical material, recorded examples, existing local configuration, unused legacy static assets, and command redirects. It is not a runtime workspace.

## Verification results

| Check | Result |
| --- | --- |
| Root clean `npm ci` | Passed; clean Linux image installs also passed without legacy node_modules. |
| `npm run build` | All seven application/shared builds passed. |
| `npm run check` | All eight projects passed. |
| `npm run lint` | All eight projects passed, including negative import-boundary probes. |
| Browser declarations | Compile with DOM/ES libraries and no ambient Node, MongoDB, Mastra, or TypeSafe declarations. |
| `npm test` | 111 backend tests and 23 dashboard tests passed; two existing optional Mongo adapter tests skipped. |
| `npm run test:integration` | Four isolated MongoDB tests passed, including API launch, worker execution, private memory, leases, immutable review history, and pagination. |
| `node scripts/verify-migration-equivalence.mjs` | Pre-migration hashes match for configuration, pairs, initial run state, normalized saved trace, windows, definitions, and exact Jev request payloads/key maps. |
| `node scripts/verify-compiled.mjs` | Plain Node emitted-code smoke passed: API pair submission/idempotency, scripted worker completion, provenance, exports, SPA deep links, and JS assets. |
| Nx affected graph | A contracts change selects all eight dependent projects; operational targets explicitly disable caching. |
| Local cache restoration | With API output moved aside, the API build restored identical bytes using four local cache hits; the temporary backup was removed. |
| Cache invalidation | Temporary contract and root-configuration changes each forced all four API prerequisite/build tasks to rerun; restoring each file returned four cache hits. Both affected selections included all eight projects. |
| Development propagation | Editing a shared contract rebuilt its output and restarted the dashboard consumer; restoring the source rebuilt and restarted it again. Temporary processes were stopped. |
| Docker | All three production images and optional Studio image built successfully. |
| Container runtime | API and both workers started on isolated test databases. A matched scripted pair completed across API/experiment-worker containers; Studio `/` and `/api/agents` returned 200. |

The API runtime image contains no source, Nx, tsx, Mastra, or TypeSafe SDK. Worker runtime images contain no source, frontend assets, Nx, or tsx. The experiment worker does not contain the TypeSafe SDK. Shared build provenance is generated from source and the lockfile and shipped as an immutable JSON artifact; runtime processes do not need development files to identify their build.

The baseline sandbox blocked localhost HTTP tests; final HTTP and Mongo verification ran with local networking available. Vite also required permission to replace previously generated assets. The host has Node 24.7.0, below the retained package engine floor; clean image builds and container smoke used Node 24.11.1. Test file concurrency defaults to two to avoid nested Nx/Node/esbuild thread exhaustion.

## Deployment continuity

Root `compose.yaml` retains the named `sidechannel-harness-mongo` volume and the observed `agent_default` backend network. Only the researcher API joins the tunnel network; its `dashboard` network alias preserves an existing tunnel origin. Root and legacy environment loading is documented in [harness operations](harness-operations.md). The default tunnel secret still resolves under `agent/secrets/`.

No deployment cutover, guard reset, live inference, old-run rewrite, or production data migration was performed. Container verification used disposable containers and uniquely named databases, which were removed afterward. Follow the documented stop/drain/manual-recovery procedure before replacing an active experiment worker.

## GitHub Actions

- `.github/workflows/verify.yml` installs the root lockfile, compares explicit affected base/head revisions, runs full verification plus compiled/equivalence checks, and creates an isolated MongoDB replica set for integration tests.
- `.github/workflows/docker-publish.yml` builds/publishes separate API, experiment-worker, analysis-worker, and Studio image targets with independent cache scopes. Pull requests build without publishing.

These commands and image targets were verified locally. GitHub-hosted workflow execution and GHCR publication were not performed as part of this migration.
