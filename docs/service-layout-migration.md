# Service layout and Nx monorepo migration

Status: proposed migration plan, not an implemented reorganization. Updated November 7, 2026.

## 1. Objective

Split the existing backend source tree into top-level researcher API, experiment-worker, and analysis-worker packages. Keep the React frontend in `dashboard/`. Extract shared contracts, domain logic, and MongoDB persistence into explicit workspace packages. Use Nx over npm workspaces to manage the project/task graph, dependency-aware execution, local build caching, and affected checks.

Nx is part of the proposed migration; this document does not install it or perform the service split. Retain the top-level directories below rather than introducing an additional `apps/` layer. npm handles package installation/linking, while Nx orchestrates development and verification tasks. Nx supports incremental adoption in an existing package-manager workspace. See [adding Nx to an existing monorepo](https://nx.dev/docs/kb/adding-to-monorepo).

The services already run as separate processes. This migration makes code ownership, dependencies, builds, and deployment artifacts reflect those boundaries. It does not introduce new distributed services or change the experiment, Jev analysis, or oversight methodology.

The API may continue serving the built dashboard at `/` and API routes at `/api/...`. Source/package separation does not require a separate frontend hosting service, another public hostname, or another Cloudflare Tunnel.

## 2. Current implementation

The following reflects source inspection, not a claim that every workflow has passed end-to-end validation:

| Component | Current location and behavior |
| --- | --- |
| React frontend | `dashboard/`, with its own package manifest and lockfile. Vite proxies `/api` to port 4310 during development. |
| Researcher API | `agent/src/server.ts` wires the HTTP server, MongoDB, Jev routes, review routes, and oversight routes. `agent/src/server/index.ts` serves both API requests and `dashboard/dist` assets. |
| Experiment worker | `agent/src/worker.ts` opens the Mastra-backed runtime and executes queued runs under the existing worker guard. |
| Analysis/monitor worker | `agent/src/analysis-worker.ts` runs Jev and direct oversight jobs using research leases. |
| Shared backend package | `agent/package.json` currently owns HTTP, scheduler, persistence, Mastra, Jev, monitor, and operational tooling dependencies. |
| Container build | `agent/Dockerfile` builds the frontend and Mastra output into one application image used by several Compose services. |
| Deployment | `agent/compose.yaml` already defines separate dashboard/API, experiment worker, analysis worker, Mastra Studio/API, MongoDB, and optional tunnel services. |

The important source dependencies to resolve are:

- The dashboard imports types directly from `agent/src/harness/contracts`, `agent/src/oversight/contracts`, and analysis files, including repository modules. One frontend test imports harness configuration directly.
- The API imports `createQueuedRun` from `harness/scheduler.ts`. That file also owns scheduler execution and imports the scenario/gateway implementation.
- Jev's preparation service imports question-building helpers and constants from `jev-provider.ts`, which imports the TypeSafe SDK. Request preparation should not require a live provider adapter.
- API and workers share MongoDB implementations from the harness and research directories. Some persistence modules also declare transport-facing types.
- The API's static-directory resolution, Docker copy paths, package scripts, environment-file paths, and Compose paths assume the current directory layout.

Moving directories without addressing these dependencies would leave the same coupling under different names.

## 3. Proposed repository layout

```text
sidechannel/
├── package.json                 # Private npm workspace and root commands
├── package-lock.json            # Workspace lockfile
├── nx.json                      # Nx plugins, shared inputs, target defaults, cache policy
├── eslint.config.mjs            # Import-boundary enforcement
├── tsconfig.base.json           # Common options; environment-specific configs remain local
├── compose.yaml                 # Deployment entry point
├── dashboard/
│   ├── package.json
│   └── src/                     # React, shadcn/ui, Tailwind, browser API client
├── api/
│   ├── package.json
│   ├── Dockerfile
│   └── src/
│       ├── main.ts              # Composition root and HTTP startup
│       ├── server/              # HTTP infrastructure and static hosting
│       └── routes/              # Experiment, Jev, review, and monitor handlers
├── experiment-worker/
│   ├── package.json
│   ├── Dockerfile
│   └── src/
│       ├── main.ts
│       ├── harness/             # Scheduler, gateway, execution adapters
│       ├── mastra/              # Mastra runtime and optional Studio entry point
│       └── commands/            # Fixture, recovery, live experiment smoke tools
├── analysis-worker/
│   ├── package.json
│   ├── Dockerfile
│   └── src/
│       ├── main.ts
│       ├── jev/                 # Job execution and TypeSafe adapter
│       ├── oversight/           # Direct monitor execution and provider adapter
│       └── commands/            # Analysis smoke and diagnostic commands
├── packages/
│   ├── contracts/              # Public DTOs, portable schemas, server ports
│   ├── domain/                 # Shared deterministic rules and preparation services
│   └── persistence/            # MongoDB implementations, indexes, transactions, leases
├── tests/
│   └── integration/            # Tests crossing package/service boundaries
├── docs/
└── ...                         # Existing research material and repository configuration
```

Use private package names such as `@sidechannel/api`, `@sidechannel/experiment-worker`, `@sidechannel/analysis-worker`, `@sidechannel/contracts`, `@sidechannel/domain`, and `@sidechannel/persistence`. Keep the existing dashboard package name or rename it consistently during migration; the choice does not change its ownership. Register each application/shared package as an Nx project, using package metadata and inferred targets where appropriate. Use `project.json` only where explicit configuration is clearer; do not duplicate target definitions across files.

The additional `domain` package gives shared run construction and analysis preparation an explicit home. These are executable application rules, so they should not be placed in a types-only package or imported from another service's source tree. Keep this package divided by experiment, analysis, and oversight responsibilities rather than building a miscellaneous utilities directory.

The tree is a target, not authorization to remove the existing `agent/` directory before every source, fixture, operational command, and document has been accounted for.

## 4. Ownership and dependency rules

| Package | Owns | Must not own |
| --- | --- | --- |
| `dashboard` | Views, forms, charts, display preferences, browser transport | Database access, provider credentials, worker execution |
| `api` | HTTP validation/routing, application composition, job submission, previews, static frontend hosting | Agent turns, inference execution, worker polling loops |
| `experiment-worker` | Agent scheduling, tool execution, private memory integration, Mastra runtime, experiment recovery | Researcher HTTP routing, Jev classification, monitor evaluation |
| `analysis-worker` | Jev jobs, monitor calls, research retry/cancellation/lease behavior | Experiment scheduling, frontend serving |
| `contracts` | Serializable DTOs, shared validation schemas, provider-neutral/repository interfaces | SDK clients, database connections, environment reads, process startup |
| `domain` | Configuration resolution, run initialization, codebook/question construction, evidence normalization/windowing, projection and review rules | HTTP listeners, concrete MongoDB clients, model-provider clients |
| `persistence` | MongoDB repositories, query implementations, indexes, transaction and ownership mechanics | Browser DTO design driven by MongoDB types, inference, HTTP handlers |

Allowed dependency direction:

```text
dashboard ──────────────────────> contracts/browser
api / experiment-worker / analysis-worker
    ├──> contracts
    ├──> domain ────────────────> contracts
    └──> persistence ───────────> contracts, domain where needed
```

Services do not import each other's source or packages. Shared packages do not import services. Domain services receive repository/provider-neutral interfaces explicitly; they do not create a MongoDB connection or import a worker to perform an action.

Define separate browser-safe and server-only contract exports. The browser-facing entry point must not re-export server interfaces that bring Node, MongoDB, Mastra, or provider declarations into frontend type checking. Portable runtime schemas can use an explicitly declared browser-compatible validator dependency. Database-native types belong in persistence, with serializable representations at API boundaries.

Use explicit package exports/subpaths and actual workspace dependencies. Do not rely on TypeScript path aliases alone, runtime imports into sibling `src` directories, or hoisting to hide an undeclared dependency. Avoid barrel exports that pull every module into every consumer.

Provider SDKs belong to the worker that invokes them. Shared question construction uses provider-neutral values; the worker translates those into SDK requests. If the monitor adapter legitimately uses a Mastra/provider library, declare that dependency in the analysis worker without importing the experiment runtime. API startup must work without model credentials.

## 5. Source migration map

Split mixed-responsibility files before moving them wholesale:

| Current source | Target ownership |
| --- | --- |
| `agent/src/server.ts` | `api/src/main.ts` composition root |
| `agent/src/server/` | API server/routes; portable configuration schemas move to contracts/domain as appropriate |
| `agent/src/worker.ts` | `experiment-worker/src/main.ts` |
| Scheduler/gateway/runtime and Mastra adapters | Experiment worker |
| `createQueuedRun` currently in `scheduler.ts` | Shared experiment initialization in domain, separate from scheduler execution |
| `harness/config.ts` | Shared configuration logic in domain; portable wire types/schemas in contracts |
| `harness/contracts.ts` | Split browser DTOs, server interfaces, and worker-local details by consumers |
| `harness/scenario.ts` | Separate pure initialization/metadata needed by API from execution/tools owned by the experiment worker |
| `harness/repository.ts` | MongoDB implementation in persistence; move public data shapes/interfaces out of its implementation module |
| `agent/src/mastra/` | Experiment-worker Mastra/Studio entry points |
| `analysis-worker.ts` and `jev-analysis-worker.ts` | Analysis-worker main entry and optional diagnostic/standalone command |
| Jev extension/routes and review routes | API routes, depending on shared services/interfaces |
| Analysis configuration, normalization, windows, serialization | Shared domain logic used by preview/preparation and job execution |
| `jev-service.ts` | Shared preparation/application service with injected repositories; remove provider SDK dependency |
| `jev-provider.ts` | Split question construction/types from the TypeSafe execution adapter; adapter goes in analysis worker |
| Jev worker logic | Analysis worker |
| Analysis/review repositories and `store.ts` | Persistence implementations, with shared record/interfaces extracted |
| `oversight/api.ts` | API routes |
| Oversight contracts/projections/service/reviews/comparison | Contracts and shared domain according to responsibility |
| Oversight worker/provider | Analysis worker |
| Dashboard imports into `agent/src` | Named workspace contract imports; move shared fixture support out of runtime services |

For `createQueuedRun`, preserve the existing scenario initialization result and config hash exactly. Do not replace it with an empty generic state to make an import easier. If the scenario includes both metadata and execution, introduce a lightweight shared initialization module while keeping tool execution inside the worker.

For Jev, preserve the serialized question payload and question-key mapping during extraction. An SDK-free question builder may need a worker-side translation layer; verify equivalent requests rather than treating it as a cosmetic move.

Keep service-local tests with their modules. Put tests spanning API submission, persistence, and worker execution under the root integration suite. Shared test fixtures should have a clearly test-only home; do not export fixture setup through a production browser entry point merely to satisfy frontend tests.

## 6. Workspace and build strategy

Use Nx with npm workspaces, retaining the repository's current package manager. Consolidate the two current lockfiles into one root workspace lockfile through npm's normal lockfile generation. Preserve dependency versions wherever possible; do not combine the layout migration with unrelated SDK upgrades. Pin Nx and compatible official plugins at implementation time after checking their Node, TypeScript, and Vite requirements against this repository.

Each service needs its own manifest, explicit dependencies, entry point, and `dev`, `build`, `start`, `check`, and relevant `test` commands. Shared packages expose built ESM JavaScript and declaration files through explicit exports. Choose a Node-compatible module-resolution/build configuration and test emitted code, not only development execution through `tsx`.

The dashboard retains its DOM/Vite configuration. Backend packages use Node settings. Existing frontend/backend TypeScript versions differ; a shared base config must not force an unverified compiler or browser/server setting onto every package. Align versions only where required and validate that change separately within the migration.

Build shared packages before dependent services using Nx task dependencies. Use TypeScript project references where appropriate for declarations and incremental type checking; Nx does not replace valid package exports or TypeScript configuration. Watch mode must also rebuild shared outputs so an edited contract is not served from stale compiled files. See [Nx with TypeScript](https://nx.dev/docs/technologies/typescript/introduction).

### Nx project and target setup

Start with the Nx core and explicit targets wrapping existing commands. Add `@nx/js` for the selected TypeScript build workflow and `@nx/vite` for the frontend where their integration helps. Keep the existing test runners; do not migrate Node tests to another runner solely to adopt Nx. If Vitest task inference is desired, use the plugin supported by the pinned Nx release; current Vite documentation identifies Vitest integration separately. See [Nx with Vite](https://nx.dev/docs/technologies/build-tools/vite/introduction).

Inspect the inferred targets before adding overrides. Each finite target should have one owner and declared output locations. Underlying package scripts must invoke the actual compiler/test command, not recursively invoke the same Nx target. Root convenience scripts can delegate to Nx.

| Target | Intended behavior |
| --- | --- |
| `build` | Build prerequisite workspace dependencies first, then the project; declare its own output directory. |
| `check` | Type-check the project with required shared declarations available. |
| `lint` | Run import-boundary checks and the project's configured lint rules. |
| `test` | Run deterministic unit/API tests with mocked providers and isolated in-memory fixtures. |
| `dev` / `start` | Run a server or worker; never cache. Configure long-running targets so they do not block unrelated task scheduling. |
| `test:integration` | Run explicit cross-service/MongoDB checks against isolated test data; never cache initially. |
| Smoke, fixture execution, recovery | Explicit operational targets; never cache or include in ordinary affected checks. |

Keep TypeScript/source dependencies separate from packaging needs. For example, assembling the API production image needs the dashboard build output, but API source code must not import the dashboard. Declare that asset-build prerequisite on a packaging target or Docker build stage, not as a spurious runtime package dependency. Nx remains build/development tooling; production containers should run their compiled entry points without requiring the Nx daemon.

### Caching and affected execution

Use local Nx caching initially; Nx Cloud/remote caching is optional later and not required for this migration. Explicitly opt reproducible finite tasks into caching. Configure source files, shared configuration, dependency outputs, lockfile/toolchain inputs, and any relevant non-secret build variables so changes invalidate the correct tasks. Declare outputs narrowly per project. See [Nx task caching](https://nx.dev/docs/features/cache-task-results).

Never cache agent runs, Jev requests, monitor evaluations, database migrations, fixture population, recovery, or deployment commands. Their real-world side effects and evidence must actually occur when invoked. A deterministic test using mocked inference may be cacheable; a similarly named live provider smoke test is not. Database state and model aliases are not reliable cache inputs for research execution.

Do not put MongoDB exports, live traces, credentials, or generated experiment evidence in Nx output directories. Exclude `.nx` local cache/workspace data from source control and production artifacts. Preserve existing provenance behavior: if a build embeds the Git revision or another changing identifier, include that value in its inputs or generate provenance separately so a cache hit cannot misidentify a build.

Use affected lint/check/test/build tasks in CI with an explicit correct base/head comparison. An imported shared-contract change must select dependent consumers. Changes to root configuration and deployment paths must invalidate the relevant checks; cross-service integration/deployment tests need explicit scheduling where the source graph alone cannot capture them. Run full verification at migration completion rather than relying exclusively on affected selection before the graph has been validated.

### Enforced boundaries

Tag projects by layer, such as `layer:frontend`, `layer:service`, `layer:contracts`, `layer:domain`, and `layer:persistence`. Apply the dependency rules in section 4 using the Nx ESLint module-boundary rule, with lint included in verification. This checks JS/TS imports and package dependencies without requiring enterprise conformance tooling. See [Nx module boundaries](https://nx.dev/docs/features/enforce-module-boundaries).

Project-level tags cannot alone distinguish `contracts/browser` from `contracts/server` inside one package. Add restricted-import rules for frontend consumers and verify the browser dependency graph. Explicitly disallow sibling service source imports, upward shared-to-service dependencies, and deep imports that bypass package exports. Test these restrictions with representative violations during setup; configuring tags without running enforcement is insufficient.

Proposed root command surface, to be implemented during migration:

| Command | Responsibility |
| --- | --- |
| `npm ci` | Install the locked workspace dependency graph |
| `npm run dev:dashboard` | Start Vite with `/api` proxying to the researcher API |
| `npm run dev:api` | Start API development server on the existing port 4310 |
| `npm run dev:experiment` | Start the experiment worker |
| `npm run dev:analysis` | Start the combined analysis/monitor worker |
| `npm run build` | Delegate to Nx for dependency-ordered shared-package and application builds |
| `npm run check` / `npm test` / `npm run lint` | Delegate finite package checks to Nx with the appropriate cache policy |
| `npm run test:integration` | Run cross-service tests with the required isolated MongoDB setup |
| `npm exec -- nx graph` | Inspect project dependencies and verify service boundaries |
| `npm exec -- nx affected -t lint check test build` | Run affected finite tasks against explicitly configured base/head revisions |

Package-targeted commands should work independently once shared dependencies are built. Root scripts are convenience entry points, not a place to implement service logic. Update contributor instructions and operational docs in the same migration. Historical plans can retain their old paths if clearly identified as historical.

## 7. Deployment and runtime behavior

### Frontend hosting and API

The production API continues to serve built dashboard assets and `/api` on the same origin. Copy `dashboard/dist` into a known path in the API image and configure static hosting explicitly, with a suitable development default. The existing relative path in `server/index.ts` must not accidentally resolve against compiled output in the wrong directory.

Keep Vite's development proxy pointing at the API. The Cloudflare Tunnel routes to the API/static-hosting service; it does not expose the workers, MongoDB, or Mastra Studio. Preserve the agreed initially open access mode. This migration is not an authentication redesign.

### Images and Compose

Create separate API, experiment-worker, and analysis-worker image targets, whether implemented through individual Dockerfiles or a shared multi-stage build. Each image needs only its runtime dependencies and shared package outputs. The API image includes frontend assets; worker images do not. Building the API should not require running a Mastra build simply because the old all-purpose image did.

Move the deployment entry point to root `compose.yaml` and update build contexts, working directories, secret-file paths, and documentation. Service names may become `api`, `experiment-worker`, and `analysis-worker`; if renamed, update tunnel origin configuration, `depends_on`, health checks, and operational scripts together. Keeping a temporary Compose alias is acceptable if documented.

The optional Mastra Studio/API process remains an additional tooling service built from experiment-worker sources. It is not the researcher API and need not become another top-level application package. Preserve its availability and current port behavior unless deliberately changed in a separate task.

The current `.dockerignore` is an allowlist centered on `agent/` and `dashboard/`. Update it to include workspace manifests, shared packages, and the new service sources while continuing to exclude environment files, secrets, generated output, and local dependencies.

### Environment, data, and ownership

Document environment loading explicitly. Moving scripts changes how `../.env` and local `.env` paths resolve. Preserve effective configuration with an intentional precedence order; never copy real credentials into new package examples or frontend assets. API needs database and hosting settings; experiment credentials belong to the experiment worker, and Jev/monitor credentials to the analysis worker.

Preserve MongoDB database names, collections, indexes, existing record IDs, hashes, and the named persistent volume. Moving Compose changes its default project directory/name, so retain explicit volume/network behavior where needed and verify the existing data volume is reused. This should be a source/deployment migration, not a database reset or data-format migration.

Preserve the experiment's manual crash-recovery guard and the research worker's independent expiring leases. During deployment cutover, stop the old worker process before starting its replacement. Do not clear guards or forcibly reassign jobs just because the directory changed. Allow in-flight work to finish or follow the existing cancellation/recovery procedure. Prefer migration verification against isolated fixture data before touching the active deployment.

Preserve run/event schema versions and definition revisions when their semantics have not changed. Record new build provenance as usual, but do not rewrite old runs. A package name or path change alone must not silently alter prompt templates, model settings, evidence serialization, or evaluation semantics.

## 8. Migration sequence

1. **Capture the baseline.** Inventory entry points, scripts, Docker/Compose paths, public routes, shared imports, fixture outputs, and current checks. Record existing failures separately. Coordinate with active work so unrelated changes are not overwritten.
2. **Introduce npm workspaces, Nx, and shared exports.** Establish root package configuration, `nx.json`, project registration, explicit targets, and boundary linting while existing entry points still work. Extract browser-safe DTOs first, then repository ports, domain helpers, and persistence. Use temporary compatibility re-exports only where necessary. Start with caching off until each finite task's inputs/outputs are verified; do not auto-enroll in remote caching.
3. **Remove frontend source-tree coupling.** Replace every dashboard import into `agent/src` with an explicit contract or test-support import. Verify frontend build and tests without copying the whole backend source tree into its build context.
4. **Extract the API.** Move composition and HTTP routes, preserve URLs and static hosting, and ensure preview/job submission depends on shared services rather than worker modules. Verify startup without model credentials.
5. **Extract experiment execution.** Move scheduler, tools, runtime, memory/provider adapters, and operational commands. Preserve run initialization and queue/guard semantics.
6. **Extract analysis and oversight execution.** Move workers and live provider adapters. Preserve API previews and request preparation through shared domain interfaces; keep Jev and oversight logically independent within the worker process.
7. **Switch build and deployment paths.** Build separate images, update root Compose, environment examples, `.dockerignore`, tunnel references, static assets, and Nx-backed root commands. Verify clean installation and compiled runtime execution, then enable local caching for reproducible tasks and configure affected CI checks.
8. **Validate and retire compatibility paths.** Run the targeted acceptance checks below, update current documentation, and remove temporary re-exports only after all consumers have moved. Account for `agent/AGENTS.md`, examples, and operational documents before retiring old directories; carry applicable instructions to their intended new scope.

Do not delete source directories, old volumes, fixtures, or credentials as an incidental cleanup step. Keep migration changes reviewable and preserve a straightforward code/deployment rollback. Because storage formats remain compatible, rollback should not require rewriting evidence.

## 9. Acceptance criteria

### Package boundaries

- All four application packages have explicit manifests and runnable entry points.
- No frontend import reaches into a backend implementation directory, including type-only imports.
- No service imports another service's source. Shared packages have no upward dependency on a service.
- The contracts browser entry builds without Node/MongoDB/Mastra/TypeSafe runtime dependencies.
- API startup and scripted submission do not require a model-provider key or load a worker loop.
- A clean workspace install/build works without leftover `agent/node_modules`, undeclared hoisted dependencies, or old compiled files.

### Nx verification

- The project graph represents the four applications and shared packages with no service-to-service source dependency or shared-to-service cycle.
- Build dependencies produce shared outputs before consumers; watch mode reflects shared-code edits.
- A repeated unchanged build can restore the declared outputs from local cache, and a shared-contract/config change invalidates the appropriate consumers.
- Affected selection includes dependent projects when shared code changes and uses the intended CI base/head.
- Boundary lint rejects a frontend server-only import and a service-to-service import, including representative type-only violations.
- Live inference, fixture population, recovery, integration/database work, and server/worker processes have caching disabled.
- Both clean uncached verification and the configured cached path pass; no production container requires Nx to start its service.

### Behavior preservation

- Existing configuration validation, matched-pair launch, idempotency, cancellation, evidence paging, and exports retain their public behavior and route shapes, including `/api/jev/...` and monitor routes.
- A scripted matched pair can be submitted through the API and executed by the experiment worker, with the same configuration resolution, tool budgeting, board deliveries, memory isolation, and report structure.
- A saved trace produces equivalent normalized steps, windows, question payloads, and definition snapshots before and after extraction, apart from explicitly expected build/time identifiers.
- Jev and oversight jobs execute independently of the experiment worker. Oversight still receives no Jev classifications or human labels.
- Review sampling provenance, two-reviewer agreement, immutable revisions, and cross-service exports remain intact.
- Existing guard/lease, retry, cancellation, and recovery tests continue to pass. No new automatic experiment restart/resume behavior is introduced.

### Deployment

- Vite development proxying and production SPA deep links work with the API on port 4310.
- All three backend images start with only their required runtime files; workers do not need dashboard assets.
- Compose reuses the intended MongoDB volume, and tunnel routing reaches only the researcher-facing origin.
- Optional Mastra tooling and fixture/recovery/smoke commands remain available and documented.

Use the existing unit/API/provider-mock tests, integration suite, and scripted fixture before adding new tests. Add focused import-boundary or clean-build checks where the migration introduces a new failure mode. Real provider calls are optional credentialed smoke checks, not prerequisites for validating a directory/package split. No performance or research-result claims follow from this migration.

## 10. Implementation choices still flexible

Exact package export names, script names, shared-package subdirectories, the compatible pinned Nx/plugin versions, TypeScript executor/reference configuration, and whether Dockerfiles share a base can be resolved during implementation. Nx over npm workspaces, local caching of reproducible tasks, and enforced service boundaries are the selected direction. Remote caching remains optional future work. These choices must preserve the service and dependency boundaries above. Do not reopen the settled React/Vite/shadcn/Tailwind choice, add another queue system, or redesign the research workflow as part of the move.

## Related documents

- [Dashboard specification](dashboard-spec.md)
- [Jev analysis specification](jev-analysis-spec.md)
- [Current dashboard operations](dashboard-operations.md)
- [Current harness setup](../agent/README.md)
- [Harness handoff](../harness_handoff.md)
- [Adding Nx to an existing monorepo](https://nx.dev/docs/kb/adding-to-monorepo)
- [Nx with TypeScript](https://nx.dev/docs/technologies/typescript/introduction)
- [Nx with Vite](https://nx.dev/docs/technologies/build-tools/vite/introduction)
- [Nx task caching](https://nx.dev/docs/features/cache-task-results)
- [Nx module boundaries](https://nx.dev/docs/features/enforce-module-boundaries)
