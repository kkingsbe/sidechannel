# Sidechannel researcher dashboard

React, Vite, TypeScript, Tailwind CSS, and customized shadcn/ui patterns built on Radix primitives. The six workspaces cover experiment configuration, source evidence, codebooks, Jev screening and human review, and independent oversight comparisons.

```powershell
# From the repository root:
npm ci
npm run build
npm run dev:dashboard
```

The development server proxies `/api` to the researcher API at `http://127.0.0.1:4310`. Production assets are generated with `npm run build` into `dashboard/dist`, which the researcher server serves at the same origin. Provider and database credentials belong to backend environment configuration.

```powershell
npm run check --workspace=sidechannel-dashboard
npm test --workspace=sidechannel-dashboard
npm run build --workspace=sidechannel-dashboard
```

Routine tests use local fixtures and mocked network responses. They do not make live provider calls. Canonical Jev requests go to `/api/jev`; `src/lib/jev-transport.ts` translates those versioned records into dashboard view models. Experiment and independent oversight APIs retain their own IDs and lifecycles.

Stable run and evidence links use the URL path and query parameters. Background polling retrieves bounded progress and evidence pages; closing the browser does not control worker execution. Color appearance defaults to the system setting and can be overridden from the sidebar.

Generic artifact rendering displays recorded structures and provenance. Complex scenario-specific configuration fields without a supported editor are explicitly marked; recorded data is preserved. No browser code recomputes task outcomes or treats Jev estimates as human reference labels.

The API and worker startup commands are `npm run dev:api`, `npm run dev:experiment`, and `npm run dev:analysis` from root. See [dashboard operations](../docs/dashboard-operations.md). Browser production imports use `@sidechannel/contracts/browser`; test fixtures use the separate test-only `@sidechannel/contracts/testing` export. Database and provider implementations never enter the frontend dependency graph.
