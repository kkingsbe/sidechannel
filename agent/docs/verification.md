> Historical pre-workspace source paths and commands. See [current operations](../../docs/harness-operations.md) and [current Jev guide](../../docs/jev-analysis.md). Saved evidence paths below are retained.

# Verification — November 7, 2026

Verified against the final implementation after recovering from a host restart:

| Check | Result |
| --- | --- |
| `npm run check` | Passed |
| `npm test` with `TEST_MONGODB_URI` set | 28 passed, 0 failed, 0 skipped |
| `npm run test:mongo` | 1 passed |
| `npm run build` | Passed; production bundle generated |
| `docker compose up -d --wait` | Healthy; named data volume retained |
| Scripted fixture | Completed; 6 turns, 103 events, 2 reports |
| Actual Mastra Agent with scripted V2 provider | Ordered proposals, unknown/invalid arguments and follow-up results verified |
| Native traces | Completed spans and usage persisted; missing trace rejects proposals |
| Private memory | Notes/history survive fresh adapters; other agents/new runs see none |
| Browser | Launched run, observed worker completion, inspected memory diff, downloaded evidence |
| Dashboard disconnect | HTTP restart does not stop the independent scheduler |
| External live provider | Not run: no provider credential configured |

The browser-launched run was `caf1aa49-9d92-46d4-88e2-9c9f9db15554`. Its downloaded JSON was checked for completed state, six turns, 103 events and a configuration hash. `examples/completed-fixture.json` is the reproducible scripted CLI export, not a live-model run.

Expected framework messages: Mongo lacks Mastra's aggregated metrics sink, but token usage persists in native span attributes and application events. The initial ephemeral test registry prints an in-memory notice; production worker initialization replaces it with Mongo-backed trace storage before inference. No unrestricted starter tools are registered.

Tests cover budget boundaries, yield, text-only endings, failed calls, mutation deduplication, board pagination/exposure, private memory, artifact versions, reports, frozen configurations/pairs, cancellation races, worker claims and partial failures. API tests cover idempotency, provenance, cursors, export, cancellation, authentication and cross-origin writes.
