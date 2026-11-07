# Live service preparation

Checked November 7, 2026, approximately 20:02 UTC, source `5a31bf79df08d4e88a90904e8ec5aa73333a4b18`. Backend preparation is ready for the user to begin the [live dashboard checklist](live-services-smoke-checklist.md). No live healthcare pair, healthcare Jev analysis, or oversight acceptance evaluation was launched.

Open [the healthcare launch form](http://127.0.0.1:4310/experiments/new). Select **Use healthcare smoke preset**, **Live Adaption · pilot**, and an available model. The production API hosts the built dashboard; port 4311's illustrative in-memory smoke server is not the application acceptance environment.

## Deployment and configuration

Compose project `agent` has exactly one API, experiment worker, analysis/monitor worker and preserved MongoDB service. API is healthy; both workers logged readiness; MongoDB `rs0` is writable primary. The missing analysis worker was built and started with:

```powershell
docker compose --env-file .env -p agent build analysis-worker
docker compose --env-file .env -p agent up -d --no-deps analysis-worker
```

All application services use database `sidechannel` and the same private Mongo endpoint. Experiment memory/traces use `sidechannel_mastra`. Backend-only Adaption keys are present in API and both workers; the analysis worker also has TypeSafe credentials. No credentials were printed or copied into source. No Mongo volumes or existing runs were reset. Final read-only database check found five existing runs, zero active runs, zero Jev jobs and zero monitor evaluations. No competing worker was launched.

Deployed API server, dashboard HTML and experiment adapter SHA-256 values match local compiled outputs. The analysis image was built from the current source, including its dependency builds. Six canonical datasets are registered, valid and runtime-supported; the preset resolves `fixture10-s101-points` version `0.3` (N=10/K=3).

## Models, definitions and independent budgets

Authenticated API discovery returned these direct hosted deployments, all launchable with 120,000 input + 4,096 output + 2,048 reserved framing tokens:

| Model | Documented combined context tokens |
| --- | ---: |
| `glm-53-flash` | 1,048,576 |
| `glm-5.2` | 786,432 |
| `qwen3.5-397b` | 131,072 |
| `gemma-4-26b-a4b-it` | 256,000 |
| `qwen3.8-27b` | 262,144 |
| `deepseek-v4-flash` | 1,048,576 |
| `gemma-4-31b-it` | 256,000 |

Adaption supports `maxOutputTokens` and `temperature` through these adapters. Serving capacities come from the versioned snapshot described in [token policy](adaption-token-budgets.md); discovery alone is not a provider inference test for every model. `glm-53-flash` was the only Adaption model inferred during this preparation.

The ordinary Codebook form has editable tentative codebook `tentative-default`, current revision `tentative-default-v1`. The Oversight form has monitor definition revision 1 with five explicit outcomes: individual/coordinated violation, false reporting, deliberate/coordinated concealment. These are tentative editable definitions, not validated classifiers. The API initializes defaults idempotently when first requested.

Jev defaults to pinned `jev-1.14.0`, 12 steps/window and stride 4. Preview the actual healthcare windows before launch; oversized inputs remain explicit and require a new settings selection. Oversight is separately configured: choose provider `adaption`, direct model `glm-53-flash`, its 1,048,576-token context, and a separate output allowance (4,096 is a reasonable starting setting). The Oversight form initially has blank provider/model, 32,768 context tokens and a 100,000-character ceiling: these are editable defaults, not automatic discovery. Increase its independent input-character ceiling only after inspecting all four actual projection sizes and capacity estimates. The experiment's 120,000-token allowance never changes Jev or monitor limits. No automatic history or evidence trimming is used.

## Checks actually performed in this preparation

| Check | Observed result |
| --- | --- |
| Compose inventory, database routing and credential presence | Correct existing project, shared database and required keys; no secret values emitted |
| Analysis-worker image build | Passed compiled worker/contracts/domain/persistence builds |
| `npm test --workspace=@sidechannel/analysis-worker` | 15/15 passed, including official Jev transport and independent monitor transport |
| Production API GETs | `/api/models/adaption`, `/api/datasets`, `/api/jev/codebooks`, `/api/monitor-definitions` returned 200 |
| Dashboard deep links | `/experiments/new`, `/analysis`, `/oversight` returned 200 from production static host |
| One direct Jev connectivity probe, no job | `jev-1.14.0` returned one valid Noul answer in one attempt; 297 input/22 output tokens |
| One direct independent monitor connectivity probe, no evaluation | Adaption `glm-53-flash` returned requested JSON; 31 input/57 output tokens, no tool calls |
| One direct experiment adapter connectivity/trace probe, no queued run | Adaption `glm-53-flash` returned provider usage (21 input/128 output tokens); durable Mongo trace verified by adapter, trace `fce06f981be814acc9df1f4c0f283b9b` |

The experiment probe intentionally used a tiny 128-token ceiling and returned no visible text; it verifies authenticated transport, usage and durable tracing, not valid final reporting. Its trace is labelled `connectivity-only-preparation`. The initial unconfigured Mastra shell logs an in-memory-storage warning before runtime Mongo configuration; the actual probe's trace completion was verified against Mongo. Mongo's exporter also reports unsupported batch metric creation; canonical evidence, memory and trace persistence use their configured stores.

Prior full verify, Mongo integration, compiled/SPA, scoring and scripted healthcare queue/export checks are recorded in [healthcare smoke results](healthcare-smoke-results.md). They were not rerun because no application source changed in this preparation. The new analysis-worker build and focused tests cover the previously undeployed service. Connectivity probes are separate supporting evidence and do not establish full application acceptance.

## Remaining user stages

Perform the real dashboard matched pair, Jev analysis and changed-settings rerun, four-view independent oversight, human review, reload and exports. Retain exact run/job/evaluation IDs using the live checklist. No acceptance jobs were created by this preparation. Real model task performance, valid final reports, useful Jev windows, monitor JSON/citations and complete four-view capacity remain to be assessed on actual healthcare evidence.

No team tunnel hostname was provided or verified. Local readiness does not certify external access. The existing API `dashboard` network alias was preserved; no connector or remote routing was changed.
