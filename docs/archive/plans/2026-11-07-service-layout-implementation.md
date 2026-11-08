# Service Layout Implementation Plan

**Goal:** Implement `docs/archive/2026-11-07-service-layout-migration.md` while preserving the current working tree and research behavior.

**Architecture:** Four application workspaces consume explicit contracts, domain, and persistence packages. npm links built ESM packages; Nx schedules and caches deterministic checks. Three production images run compiled entry points.

**Tech Stack:** Existing TypeScript, React/Vite, Node test runner, Vitest, MongoDB, Mastra and TypeSafe versions; compatible pinned Nx tooling.

## Global constraints

- Preserve uncommitted dashboard/review changes, schemas, hashes, provider payloads, ownership guards, leases, and existing MongoDB volume.
- No service imports another service; shared packages do not depend on services; frontend consumes browser contracts only.
- No live provider calls or deployment cutover during implementation.
- Use GPT-6.1 Sol subagents as requested. Work directly in the current checkout.

## Tasks and ownership

- [x] Capture baseline checks and inventory existing entry points, deployment and dirty files.
- [x] Backend subagent: move backend source and tests; extract shared DTOs/ports, deterministic initialization/preparation, persistence and browser exports. Preserve exact scenario initialization and Jev request serialization.
- [x] Workspace subagent: create root/package manifests, Node ESM builds, Nx graph/cache/watch, lockfile, lint boundaries and affected CI. Check graph and negative boundary probes.
- [x] Deployment subagent: migrate dashboard imports, create separate images/root Compose, preserve volume/network/env behavior, migrate current operational documentation and instructions.
- [x] Parent: make source provenance available in compiled-only deployments; inspect integrated changes and run full verification.

## Verification commands

Run root `npm ci`, `npm run build`, `npm run check`, `npm run lint`, and `npm test`. Repeat the build to check local caching. Inspect `nx graph` JSON for seven application/shared projects plus the integration test project and allowed edges. Exercise boundary rejection probes and compiled API/static hosting with mocked providers. Run integration checks against isolated MongoDB data when Docker is available; never use active experiment data.

All verification completed. See [the verification record](../2026-11-07-service-layout-verification.md) for results, environment details, and deployment scope.

## Baseline (November 7, 2026)

- Existing backend and dashboard `npm run check`: pass.
- Existing dashboard `npm test`: 4 files / 20 tests pass.
- Existing backend `npm test`: 111 tests, 101 pass, 2 skip, 8 fail with sandbox `connect EACCES 127.0.0.1` in HTTP tests. Retry with local network access for final verification.
- Host Node is 24.7.0, below the existing backend declared Node 24.11 floor; this is an environment limitation, not a reason to lower package requirements.
