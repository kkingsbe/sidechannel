import type { ExperimentConfig } from "../lib/types";
import type { AdaptionModelCatalog } from "@sidechannel/contracts/browser";
import { useClients } from "../lib/clients/context";
import { useResource } from "../lib/clients/query";
import { providerOptions, useProviders, useScenarios } from "../lib/descriptors";
import { PlaybookPicker } from "./playbook-picker";
import { Button, Field, Input, Notice, Select } from "./ui";

export function ModelControls({
  config,
  replace,
  errors,
}: {
  config: ExperimentConfig;
  replace: (config: ExperimentConfig) => void;
  errors?: Record<string, string>;
}) {
  const clients = useClients();
  const providers = useProviders();
  const scenarios = useScenarios();
  const provider = providers.view(config.model.provider);
  const scenario = scenarios.view(config.scenario.version);
  const models = useResource<AdaptionModelCatalog>(
    provider.catalogPath ? `provider-catalog:${provider.catalogPath}` : null,
    () => clients.request<AdaptionModelCatalog>(provider.catalogPath!),
  );
  const budget = config.tokenBudget;
  const selectModel = (id: string) => {
    const model = models.data?.models.find((model) => model.id === id);
    replace({
      ...config,
      model: { ...config.model, id },
      ...(budget && model?.capacity
        ? { tokenBudget: { ...budget, capacity: model.capacity } }
        : {}),
    });
  };
  return (
    <>
      <Field label="Execution driver" error={errors?.["model.provider"]}>
        <Select
          data-config-path="model.provider"
          value={config.model.provider}
          onChange={(event) => {
            const nextProvider = providers.view(event.target.value);
            const settings = { ...config.model.settings };
            delete settings.playbook;
            delete settings.playbookHash;
            delete settings.playbookVersion;
            const next = {
              ...config,
              phase: nextProvider.defaultPhase ?? config.phase,
              model: {
                ...config.model,
                provider: nextProvider.id,
                id: nextProvider.defaultModelId ?? "",
                settings,
              },
            };
            if (next.tokenBudget) {
              next.tokenBudget = { ...next.tokenBudget };
              delete next.tokenBudget.capacity;
            }
            replace(next);
          }}
        >
          {providerOptions(providers.providers).map((option) => (
            <option key={option.id} value={option.id}>
              {option.optionLabel}
            </option>
          ))}
          {!providerOptions(providers.providers).some((option) => option.id === config.model.provider) && (
            <option value={config.model.provider}>{config.model.provider}</option>
          )}
        </Select>
      </Field>
      {provider.catalogPath ? (
        <>
          <Field
            label="Hosted Adaption model"
            error={errors?.["model.id"]}
            hint="Capacity is verified on the server; selecting a model preserves your input allowance."
          >
            <Select
              data-config-path="model.id"
              value={config.model.id}
              onChange={(event) => selectModel(event.target.value)}
              disabled={models.loading}
            >
              <option value="">Select an available deployment</option>
              {config.model.id &&
                !models.data?.models.some((model) => model.id === config.model.id) && (
                  <option value={config.model.id}>
                    {config.model.id} · availability unverified
                  </option>
                )}
              {models.data?.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName} · {model.capacity ? `${model.capacity.tokens.toLocaleString()} tokens` : "capacity unverified"}
                </option>
              ))}
            </Select>
          </Field>
          {(models.error || models.data?.status === "unavailable") && (
            <Notice kind="warning">
              {models.error?.message ?? models.data?.message ?? "Hosted models are unavailable."}{" "}
              <Button variant="ghost" size="sm" onClick={models.refresh}>
                Retry model discovery
              </Button>
            </Notice>
          )}
        </>
      ) : provider.playbook ? (
        <>
          <p className="helper">
            Playbook execution replays an uploaded tool-call script through the real scheduler. It validates
            instrumentation and is never study data.
          </p>
          <PlaybookPicker config={config} replace={replace} errors={errors} />
        </>
      ) : (
        <p className="helper">
          Scripted execution validates instrumentation. It is not spontaneous agent behavior.
        </p>
      )}
      {budget ? (
        <>
          <Field
            label="Maximum input tokens"
            error={errors?.["tokenBudget.maxInputTokens"]}
            hint="Conservative UTF-8 byte estimate, including history, private notes and tool definitions."
          >
            <Input
              data-config-path="tokenBudget.maxInputTokens"
              type="number"
              min={1}
              step={1}
              value={budget.maxInputTokens}
              onChange={(event) =>
                replace({ ...config, tokenBudget: { ...budget, maxInputTokens: event.target.valueAsNumber } })
              }
            />
          </Field>
          <Field label="Maximum output tokens" error={errors?.["model.settings.maxOutputTokens"]}>
            <Input
              data-config-path="model.settings.maxOutputTokens"
              type="number"
              min={1}
              step={1}
              value={Number(config.model.settings.maxOutputTokens ?? 4096)}
              onChange={(event) =>
                replace({
                  ...config,
                  model: { ...config.model, settings: { ...config.model.settings, maxOutputTokens: event.target.valueAsNumber } },
                })
              }
            />
          </Field>
          <Field
            label="Maximum private-note size (characters)"
            error={errors?.["memory.maxPrivateNoteCharacters"]}
          >
            <Input
              data-config-path="memory.maxPrivateNoteCharacters"
              type="number"
              min={1}
              step={1}
              value={config.memory.maxPrivateNoteCharacters ?? 32000}
              onChange={(event) =>
                replace({ ...config, memory: { ...config.memory, maxPrivateNoteCharacters: event.target.valueAsNumber } })
              }
            />
          </Field>
          {errors?.tokenBudget && <Notice kind="error">{errors.tokenBudget}</Notice>}
        </>
      ) : (
        <Notice kind="warning">
          This saved configuration uses a legacy character budget. Apply the healthcare preset to explicitly create a
          token-budget draft.
        </Notice>
      )}
      {scenario.modelSection === "catalog" ? null : null}
    </>
  );
}
