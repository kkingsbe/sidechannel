> Historical pre-workspace source paths and commands. See [current operations](../../docs/harness-operations.md) and [current Jev guide](../../docs/jev-analysis.md). Saved evidence paths below are retained.

# Mastra integration verification

The harness uses the installed, pinned `@mastra/core` 1.82.0, `@mastra/memory` 1.41.0, `@mastra/mongodb` 1.26.0 and `@mastra/observability` 1.23.1 APIs. The adapter boundaries are `src/harness/mastra-adapter.ts` and `src/mastra/index.ts`. Framework APIs were checked against embedded docs, public type definitions and installed implementation; package upgrades require repeating these checks.

## Proposal-only inference

Every inference constructs and registers an actual Mastra Agent with the exact provider/model string, zero provider retries, a bounded abort signal and `maxSteps: 1`. Tool schemas use `createTool` without `execute` or input callbacks. There is no workspace, shell, browser, provider-native tool or attached Agent memory. Reporting receives an empty tool catalog. Starter tools remain unregistered.

The Agent returns proposals; the application gateway validates, charges and executes them sequentially. The actual-Agent scripted-provider test proves five proposals retain returned order, including an invalid working-memory request and an unknown tool. One completion makes exactly one provider request. Follow-up history preserves tool call/result pairing, including proposals the gateway declines to execute.

Attaching native working memory to the Agent would enable automatic memory tools and tag processing outside the gateway. Instead, a detached Mastra Memory instance persists conversation history and thread-scoped notes. The explicit `update_working_memory` schema is proposal-only like every other tool; only the gateway can apply it after charging the allowance. This is the intentionally instrumented alternative permitted by the handoff, rather than interception of Mastra's automatically attached native tool.

## Private continuity and exact context

Both thread and resource IDs encode the JSON tuple `[runId, agentId]`. Fresh runs and other agents cannot share that namespace. Memory sets `workingMemory.scope: 'thread'`, `lastMessages: false`, `semanticRecall: false`, and `observationalMemory: false`.

The scheduler loads notes and history through the detached Memory adapter and explicitly constructs each request. Thus `lastMessages: false` disables native automatic history selection; it does not disable application-owned continuity. All persisted messages are recalled in creation order using `perPage: false`. The scheduler records actual selected input and applies the configured JSON-character history cap by failing on overflow, without silent truncation. This is a character cap, not a tokenizer estimate.

History is stored through public `Memory.saveMessages` APIs using deterministic per-thread index IDs. Each original message is enveloped as JSON text, with literal `<` escaped, because native message saving filters system roles and working-memory tags. Loading reverses that envelope, preserving original system, assistant, user and tool messages and tool call IDs. Snapshot versions and notes use public thread metadata and working-memory APIs. These writes are ordered but not one transaction: an uncertain partial write stops the run; automatic resume is excluded from v1. Normal snapshots only append history.

## Settings and evidence

The adapter forwards the supported general model controls as `modelSettings` and forwards nested `providerOptions`. Unknown general controls fail before inference; provider warnings of type `unsupported-setting` fail the call. Provider-specific controls must be specified under `providerOptions`. This cannot guarantee that a provider silently ignoring a setting will report it.

Application events preserve the requested context and catalog, returned text, all proposals, usage, trace/span correlation, and provider request/response metadata where Mastra exposes it. They do not claim hidden reasoning access. Credentials are runtime environment values, never model settings. Use synthetic data for the v1 fixture; raw provider payloads remain researcher-only evidence.

Native observability uses MongoDB storage, `MastraStorageExporter`, and `SensitiveDataFilter`. Exporter `flush()` may resolve after logging a failed write, so it is not sufficient evidence of persistence. With runtime persistence configured, the adapter flushes and reads the resulting trace through the public observability store, requiring the returned root span to have `endedAt` before returning proposals to the scheduler. Missing correlation, storage errors or an incomplete root throw, stopping actions at that inference boundary. This confirms durable root completion, not independent completeness of every optional child span. The application event log remains the authoritative action evidence.

Observability dual-write logging is disabled; researcher events and native spans supply the required evidence. With the installed Mongo adapter, native metric batches are unsupported and emit a warning. Token usage persists in model span `attributes.usage` and application response events; this integration does not claim a native metrics collection. Disabling log dual-writes also eliminated a roughly 30-second shutdown delay observed during the Mongo trace test.

## Reproduction

Run from `agent/`:

```powershell
npm run check
npx tsx --test src/harness/mastra-adapter.test.ts
$env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0'
npx tsx --test src/harness/mastra-adapter.test.ts
```

Mongo-enabled tests verify fresh-adapter memory continuity, isolation, idempotent history saves and persisted native traces/usage. Without `TEST_MONGODB_URI`, persistence tests are explicitly skipped. The provider is scripted inside an actual Mastra Agent; this is not a live provider call.

Verified November 7, 2026: all three adapter tests passed against local MongoDB, including a simulated missing persisted trace that must reject. The full adapter test process completed in about two seconds after disabling log dual-writes. `npm run check` also passed during implementation.

`src/harness/live-smoke.ts` is an opt-in real-provider compatibility check. It checks the installed registry and required credential variable before inference, persists/reloads a synthetic private marker, performs one tool-free reporting call and flushes native tracing. It prints only run/model identifiers, usage and trace correlation. Supply the exact provider and model selected for a pilot:

```powershell
npx tsx --env-file-if-exists=.env src/harness/live-smoke.ts <provider> <exact-model-id>
```

`MONGODB_URI` and `MASTRA_DB_NAME` select persistence; optional `SMOKE_MODEL_SETTINGS` contains the same settings shape as run configuration. No live smoke has been claimed without actual credentials and a successful provider response. A live call verifies compatibility, not spontaneous tool use or social behavior.
