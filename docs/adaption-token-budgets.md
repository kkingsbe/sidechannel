# Token budgets and hosted model discovery

Token runs explicitly opt into `tokenBudget.version: 1` and `unit: "tokens"`.
The default maximum input allowance is 120,000 tokens. `model.settings.maxOutputTokens`
is a separate generation allowance (the healthcare preset uses 4,096), and
`memory.maxPrivateNoteCharacters` separately limits private notes. Existing saved
`memory.contextBudget` values continue to mean serialized message characters.
Create a new draft or explicitly add the versioned token settings to migrate;
loading a historical run does not migrate it.

The available counter is a conservative estimator, **not an exact tokenizer**.
`utf8-byte-upper-bound`, version `1`, counts one estimated token for every UTF-8 byte
of the complete logical messages and tool-definitions JSON. This includes system,
task, policy, condition, notes, assistant tool calls and arguments, tool results,
history and tool schemas. JSON escaping can increase the estimate considerably.
Actual model token usage can therefore be much lower. No model-specific tokenizer
or provider preflight is installed for these deployments.

Provider chat-template framing is not measured by that logical serialization.
At least 2,048 additional tokens are reserved for it. Validation requires
`maxInputTokens + maxOutputTokens + reservedTokens <= capacity.tokens`; framing
is reserved once, outside the measured input allowance. The same policy runs
before both action and final-report inference. Overflow emits
`context_limit_exceeded` and fails before sending the request. The harness never
trims history or retries an unchanged overflowing payload. `context_accounted` and
`model_usage` events preserve the estimator, scope, allowance, phase and available
provider-reported usage for comparison.

`GET /api/models/adaption` makes a backend-authenticated read-only request to
`/api/v1/models?type=hosted`. Credentials never enter the response or frozen config.
The [model-list API schema](https://docs.adaptionlabs.ai/api/resources/models/methods/list)
documents IDs and optional display names, but **no context capacity field**.
An authenticated read-only catalog check on November 7, 2026 returned all seven
documented deployments, plus `max_input_tokens` and `max_output_tokens` fields
absent from that reference schema. Those per-direction fields do not establish a
combined serving limit. In particular, `glm-5.2` returned 1,048,575 in each field
while the documented combined serving limit was 786,432; this implementation uses
the lower documented combined limit.
The backend joins exact returned IDs to a versioned serving-capacity snapshot
verified November 7, 2026 against [Adaption's hosted deployment configurations](https://docs.adaptionlabs.ai/inference-stacks/models/#configurations).
An available deployment with unknown capacity remains visible and cannot launch a
token run. API availability and frozen capacity provenance are independently
validated; browser-supplied capacity values cannot override the verified values.
Model changes do not lower the requested input allowance.

The serving snapshot belongs in `packages/domain/src/harness/token-budget.ts`.
Update its version and verification date when refreshing the documented limits.
Do not substitute upstream model-card limits or the
[AutoScientist training limits](https://docs.adaptionlabs.ai/autoscientist/supported-models/).
The existing adapter accepts direct hosted IDs and only the verified generation
settings `maxOutputTokens` and `temperature`; `maxOutputTokens` maps to
[Responses `max_output_tokens`](https://docs.adaptionlabs.ai/api/resources/responses/methods/create).

Focused automated coverage (no paid inference):

```powershell
node --import tsx --test packages/domain/src/harness/token-budget.test.ts api/src/server/adaption-models.test.ts experiment-worker/src/harness/token-budget.test.ts experiment-worker/src/harness/inference-provider.test.ts
```
