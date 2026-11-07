# Mastra integration decision

The experiment uses `@mastra/core` 1.82.0, `@mastra/memory` 1.41.0 and `@mastra/mongodb` 1.26.0. Installed declarations and implementation were checked before coding. The integration test uses a real Mastra Agent with a scripted AI SDK LanguageModelV2, rather than replacing Agent with a fake.

## Execution boundary

`MastraModelAdapter.complete` performs exactly one `Agent.generate` step. Every exposed tool is a `createTool` definition with a schema and **no execute callback**. The pinned core implementation explicitly returns the proposed call unchanged when the definition has no execute. No workspace, provider-native tools, starter agent, schedules, browser or shell capability is registered. `experiment-worker/src/mastra/index.ts` registers each runtime experiment agent and its proposal-only tools, refusing executable tools.

Mastra receives no attached Memory instance. Therefore it cannot inject its native working-memory update tool, automatic history, or output-tag updater. An explicit `update_working_memory` proposal passes through the same application gateway as scenario/board/end-turn proposals. The application alone admits, charges, validates and executes it. The ordered five-call proof includes a memory update, invalid memory arguments and an unknown tool; all identifiable proposals survive for application accounting. A single framework step is not an action allowance.

Reporting supplies exactly one harness tool, `submit_report` (`ownActions`, `observations`, `limitations`, each a non-empty string), validated by the gateway like any other call; Mastra still never executes tools. `limits.reportCalls` (1 to 5) is the report retry budget per agent, and report schema version `2` is required. Framework inference retries are disabled. Cancellation and request timeout use AbortSignal. Generic sampling/output settings are allowlisted; provider controls go through `settings.providerOptions`. Unknown generic settings and provider `unsupported-setting` warnings cause explicit failure. Provider availability of settings still requires a live compatibility check.

## Private continuity

`MastraPrivateMemory` constructs a detached Memory backed by the documented MongoDBStore. Both thread and resource identities independently use the JSON-encoded `[runId, agentId]`; pair IDs never participate. Working-memory scope is explicitly `thread`; semantic recall and observational memory are false. No vector model is configured.

The adapter uses Memory `getThreadById`, `createThread`, `recall`, `saveMessages`, `getWorkingMemory`, `updateWorkingMemory` and `updateThread`, never Mastra collection internals. Notes and snapshot version live in Mastra's thread storage. History uses deterministic message IDs for idempotent retry. Saves assume append-only history and one active writer, as enforced by the scheduler; crash recovery and transactional commits across evidence and Mastra are outside v1.

Installed Memory.saveMessages intentionally filters system messages and removes working-memory XML from text. To preserve exact application context, stored messages carry a reversible JSON Message envelope, escape literal `<`, and use supported persistence roles. Original roles, tool calls, tool results and all text are decoded losslessly before provider context construction. This is Mastra conversation storage with application-managed context selection, not native automatic Agent memory processing. Complete stored history is loaded with explicit `perPage: false`; the scheduler controls the context subset and records trimming. The full supplied messages and selected provider request/response are captured in model evidence.

The scheduler automatically loads private notes into subsequent context and records before/after memory updates. Its own action controls and evidence gate must run before save. A private text response is never a board post.

## Evidence and traces

Adapter output includes actual Mastra messages, provider request/response metadata, steps, warnings, finish reason, token usage, and available trace/span IDs. Requests may contain only the details exposed by a provider, so the lossless supplied context is also retained. No hidden reasoning is assumed. Runtime Mastra registration enables tracing. With `MONGODB_URI`, the native Mongo storage exporter persists traces in `MASTRA_DB_NAME` (default `sidechannel_mastra`) and SensitiveDataFilter processes exported spans. No platform exporter transmits traces externally. Without Mongo environment configuration, test-only Mastra falls back to volatile storage and trace persistence is not claimed.

## Verification

From the repository root:

```powershell
npm test --workspace=@sidechannel/experiment-worker
$env:TEST_MONGODB_URI='mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0'
npm test --workspace=@sidechannel/experiment-worker
npm run check
```

The live Mongo proof uses dedicated database `sidechannel_adapter_test`, unique run IDs and fresh adapter instances: notes/history round-trip exactly, repeat save is idempotent, and another agent or fresh run has empty memory. Local socket access may require execution approval in restricted environments. Close owned storage with `await memory.storage.close()` after work completes.

The scripted actual-Agent proof and live Mongo persistence proof passed. No provider API key was available, so a live provider smoke was not performed. Scripted provider output establishes tool control, not real model behavior or clinical competence. Mongo trace export and provider settings require deployment/live-provider validation; do not represent these as completed live smoke results.

Runtime tracing is a value, not module state: `openTraceRuntime(resolvedMongoUri, mastraDatabaseName)` returns a `TraceRuntime` (`register`, `flush`, `verify`, `close`) that is injected into `MastraModelAdapter`; the experiment worker creates it in `openRuntime()`, and scripted/unit callers pass `NO_TRACE_RUNTIME`. Call `runtime.flush()` before export, `runtime.verify(traceId, spanId)` before trusting a trace, and `runtime.close()` on shutdown. Trace storage is separate from private memory. Runtime agent registration uses unique run+agent identities.

The optional live smoke command is `npm run smoke:live --workspace=@sidechannel/experiment-worker -- <provider> <exact-model-id>`. It runs the skill provider-registry helper, validates exact membership and credential environment-variable presence, then checks real text inference and Mongo private continuity. Optional JSON `SMOKE_MODEL_SETTINGS` configures settings. Output contains only identifiers, usage and trace correlation; it omits context, raw provider bodies, headers, notes and keys.

The actual-Agent followup proof verifies five tool results reach the next provider input, literal working-memory XML remains text without native mutation, and an unknown generic setting fails before inference. An optional native trace test checks exporter flush followed by documented observability `getTrace`; it requires an accessible MongoDB service.
