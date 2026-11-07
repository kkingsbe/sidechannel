# Healthcare dashboard implementation and readiness

Verified November 7, 2026. Source baseline: `20bc21978cc6137f2246be44f241fac1536ceb38` plus the uncommitted implementation in this workspace. No live Adaption experiment or browser walkthrough was performed.

These are scripted implementation-readiness results, not completion of the broader live service smoke. Live Adaption, Jev analysis of the healthcare trace and independent oversight remain to be exercised using the [live service checklist](live-services-smoke-checklist.md).

Subsequent backend preparation is recorded in [live service readiness](live-services-readiness.md): the analysis/monitor worker is now deployed against the application database, and bounded real Jev, independent monitor and experiment-transport probes succeeded. Those probes did not launch the user-owned healthcare acceptance jobs.

## Ready for the user walkthrough

Open **http://127.0.0.1:4310/experiments/new**, then **Use healthcare smoke preset**. The default is `fixture10-s101-points`, dataset version `0.3`, N=10, K=3, scenario `healthcare-points-v0.3`, artifact schema `healthcare-ranking-v0.3`. All six canonical packages are validated and registered in the local `sidechannel` Mongo catalog. The five panel40 variants remain explicit selections.

The tested `healthcare-smoke-v1` profile uses 3 fixed rounds, 8 admitted calls per turn, 8 model steps per turn, board pages of 10 (maximum 50), 10,000-character posts, 32,000-character private notes, 120,000 input tokens and 4,096 output tokens. The five-role scripted driver acts only from its model inputs and tool results. A separate four-round prohibited-action test verifies retrieval, publication, receipt and join attribution.

Choose **Live Adaption · pilot**, then a hosted model. The backend-authenticated catalog exposes available direct deployment IDs and verified serving capacity. Changing models preserves input/output allowances; incompatible limits prevent launch. `glm-53-flash` passed API configuration preflight with the default allowances. This preflight did not queue a run.

The conservative byte-based input estimate includes messages, notes and tool definitions, with 2,048 tokens separately reserved for unmeasured framing. Historical configurations retain character labels. See [token policy and capacity sources](adaption-token-budgets.md). Estimates and provider usage are recorded separately.

Runs retain progress, explicit board deliveries, private memory, trace references and private reports. **Artifacts** renders ranked cases and frozen versions. **Researcher results** separates execution status, artifact completeness, approved ranking utility and full-information utility. Scores do not establish violation, coordination or concealment.

## Verification results

| Command/check | Result |
| --- | --- |
| `npm run verify` | Passed lint/boundaries, type checks, tests and build |
| `npm run test:integration` | Passed all five Mongo-backed integration tests |
| `npm run smoke:healthcare -- --keep` | Passed final HTTP → ordinary worker queue → Mongo reload/export path, including immutable registration conflicts and stored corruption rejection |
| `npm run test:compiled` | Passed compiled ESM API, worker, exports, provenance, SPA deep links and assets |
| `npm run datasets:bootstrap -- --dry-run` | All six packages valid |
| `npm run datasets:bootstrap` | All six registered; repeated imports idempotent |
| Compiled container bootstrap | All six packages imported successfully |
| `docker compose -p agent build api experiment-worker` | Both service images built |
| Python reference tests | All nine passed independently |
| Scoring vectors | All 16 checked-in vectors matched |
| Dashboard tests | 50 passed, including healthcare controls, blocked readiness, five-role display, ranking and result states |

Final retained scripted evidence is in isolated database `sc_healthcare_smoke_efecfe0e90184996959b8abb9f545f7f`, with memory database of the same name plus `_memory`:

- Pair: `pair-scripted-healthcare-smoke`.
- Runs: `7cb6eb77-46ba-4860-9910-70828b5032ff`, `4cd4ba92-9186-4e5e-99d7-54511561a739`.
- Both completed 15 turns, froze artifact version 2, captured five valid reports, and matched the approved top-3 exactly.
- Evaluator: `healthcare-utility-v1`; approved overlap 3/3, full-information overlap 2/3. These are scripted instrumentation checks, not research findings.
- Package hash: `bff60a3cf259afe9508632e471883bd7ecca5ffbb7771529935562ff60b60dfe`.
- Truth hash: `17fd4fe715f606969d9e4fa5a5346ca42d9c80fe86ee0d6cd7223b5c87724dfc`.

Retained smoke databases are separate from the normal dashboard database. To inspect this evidence through a second API instance without switching the main deployment:

```powershell
$env:MONGODB_DB_NAME = 'sc_healthcare_smoke_efecfe0e90184996959b8abb9f545f7f'
$env:HARNESS_PORT = '4312'
node --env-file-if-exists=.env api/dist/main.js
```

Open `http://127.0.0.1:4312/runs/7cb6eb77-46ba-4860-9910-70828b5032ff?view=results`. No worker is needed to inspect completed evidence. Use a separate terminal so these environment overrides do not affect future service launches.

## Bootstrap and repeatable smoke

Run from the repository root:

```powershell
npm run datasets:bootstrap -- --dry-run
npm run datasets:bootstrap
npm run smoke:healthcare -- --keep
```

The bootstrap command loads all six packages by default; positional package directories select explicit imports. It validates canonical bytes, hashes, strict structures, table/archive relationships, recomputed scoring and ambiguity witnesses. Conflicting identities fail. Partial or corrupted registrations cannot launch.

The smoke command creates an isolated Mongo database, launches a matched pair over HTTP, spawns the ordinary worker queue process, and verifies reports, artifacts, memory events, evaluator references/results, pagination and exports. It makes no provider inference calls. Omit `--keep` to remove its test databases afterward.

For the compiled API container:

```powershell
docker compose -p agent exec api node dist/healthcare/bootstrap.js
```

The API image contains canonical files only for bootstrap. Worker images do not copy that directory. Runtime assets, evaluator truth, frozen references and researcher evaluations use separate access paths. Researcher exports include a separate `researcherEvaluation` section; results and truth are absent from the source run and model-facing projections.

## Local operational state

At the final check, the API container was healthy, the experiment worker was running and logged readiness, Mongo replica set `rs0` was primary, the application queue was empty, and `/experiments/new` returned HTTP 200. The API catalog returned six datasets and seven available Adaption models. The worker registration endpoint has no heartbeat and correctly labels live availability unknown; process/container state was checked separately.

The existing deployment uses Compose project `agent`, networks `agent_default` and `agent_tunnel`, and the preserved Mongo service at `127.0.0.1:27018`. Use `-p agent` for this deployment. An abandoned worker guard was removed only after verifying zero active runs and no worker process; the transaction matched its exact previous owner and changed no run records.

API model discovery now requires `ADAPTION_API_KEY` as well as the inference worker. Compose supplies it only to backend services. Credentials never enter catalog DTOs or frozen configurations. The initial open research deployment remains unchanged.

The tunnel network preserves the API alias `dashboard`, keeping both `http://api:4310` and the prior `http://dashboard:4310` origin compatible. No external tunnel hostname was supplied or verified, and no tunnel was provisioned or reconfigured. The scripted checks recorded here did not require the analysis worker; the expanded live service smoke does require it and its provider credentials.

The remaining user-owned checks are the live browser walkthrough, live Adaption matched pair, live Jev analysis and settings rerun, independent live oversight comparison, and persistence/review/export inspection. Live service success is not claimed.
