# Dashboard verification

Verified locally on 2026-11-07 against the canonical Jev backend implemented in the parallel Jev chat. The dashboard uses `/api/jev` through a typed transport adapter; oversight remains a separate research workflow.

The service-layout migration began during final verification. Before that move, the complete backend suite passed 109 tests (two optional tests skipped), all four Mongo integration tests passed, and the production image built successfully. The migration chat owns the final workspace-wide typecheck, tests, and container builds. Dashboard runtime bundling and final mobile/browser checks also passed after its imports changed; those checks alone do not establish that the migrated workspace build is complete.

## Automated checks

- Backend TypeScript checking and deterministic Node tests cover experiment launch/revisions, source evidence, canonical Jev execution/reviews, four-view oversight, worker recovery, cancellation, citations, and two-reviewer outcome agreement.
- Mongo integration tests exercise isolated databases for experiment persistence, draft/launch concurrency, analysis leases, frozen inputs, and review revisions.
- Frontend component and transport tests cover ordinary matched-pair forms, incomplete drafts, exact board-message lookup, safe evidence text, blinded review, revision conflicts, canonical API mapping, and preservation of missing versus zero scores.
- The migrated API Dockerfile explicitly packages the Vite frontend; experiment and analysis workers use separate compiled images. Optional Mastra Studio has a separate build target. Migration image-build results are recorded separately from the dashboard baseline checks. Compose validation checks the separate researcher API, experiment worker, analysis/monitor worker, and optional dashboard-only tunnel routing.

## Interactive acceptance

The disposable `npm run smoke:dashboard --workspace=@sidechannel/integration` workspace uses real scripted harness events and explicitly labelled simulated Jev and monitor responses. It makes no provider calls and does not access the production Mongo database.

Browser checks verified:

- Create, save, validate and explicitly launch a matched pair using ordinary forms; inspect the frozen pair differences.
- Recover an incomplete draft without replacing its saved content.
- Page a timeline, open an event with the keyboard, and refresh its deep link.
- Inspect a board post by its actual message ID and restore the same inspector from a shared link.
- Open two saved analyses with different fixed windows, inspect score tables and actual canonical source event links, and use the canonical complete-export route.
- Save one run reference as provisional, then agree as a second claimed reviewer; `uncertain` remains an agreed uncertainty.
- Inspect independent monitor configuration and the four-view result matrix with unavailable rates when binary denominators are absent.
- Switch light/dark themes and navigate the narrow layout. Overview and analysis had no document-level horizontal overflow at a 375-pixel viewport; wide tables retain their own scrolling.

## Operational limits

Public Cloudflare reachability is unverified. The application and Compose routing are prepared, but the external hostname, tunnel credentials, and account-side Access configuration were not provisioned or changed by this dashboard task.

Browser acceptance used simulated inference. It does not establish model quality or validate a live monitor provider. Research wording, context limits, and model choices remain explicit pilot settings.

See [dashboard operations](../dashboard-operations.md) for startup, persistence, worker ownership, exports, and deployment instructions.

## Service migration verification (November 7, 2026)

Root Compose configuration validates with both optional profiles enabled. Separate API, experiment-worker, analysis-worker and Mastra Studio targets build on the pinned Node 24.11.1 Linux image using the root lockfile. The API image contains the dashboard build and no Mastra/TypeSafe SDK, source tree, Nx or tsx. Worker runtime images contain compiled entry points without dashboard assets, source trees, Nx or tsx; the experiment image excludes TypeSafe.

Temporary API and both worker containers started on uniquely named isolated databases attached to the existing `agent_default` MongoDB network. API startup required no model key. The API served the SPA and a refreshed run deep link, accepted a scripted matched pair, and the experiment container completed both runs. The analysis container independently reached its ready state. An offline Studio container returned HTTP 200 for `/` and `/api/agents`.

All four temporary containers and their two temporary databases were removed afterward. The running deployment, named MongoDB volume, existing research data and tunnel account configuration were not changed. These checks establish packaging and scripted execution, not live provider quality or public reachability.
