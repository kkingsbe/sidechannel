import type { DatasetCatalogItem } from "@sidechannel/contracts/browser";
import type { ExperimentConfig } from "../lib/types";
import { useApi, useMutation } from "../lib/api";
import { useScenarios } from "../lib/descriptors";
import { useClients } from "../lib/clients/context";
import { Button, Field, Loading, Notice, Select } from "./ui";

/** Catalog, apply and availability logic shared by the dataset picker and the "Start from" selector. */
function useHealthcarePreset(
  config: ExperimentConfig,
  replace: (config: ExperimentConfig) => void,
) {
  const clients = useClients();
  const scenarios = useScenarios();
  const catalog = useApi<DatasetCatalogItem[]>(clients.workspace.paths.datasets());
  const mutation = useMutation();
  const healthcare = scenarios.view(config.scenario.version).presentation.hasDatasetPreset;
  const selected = catalog.data?.find(
    (item) =>
      item.datasetId === config.scenario.datasetId &&
      item.datasetVersion === config.scenario.datasetVersion,
  );
  const apply = async (id: string) => {
    const preset = await mutation.run(() => clients.workspace.preset(id));
    if (!preset) return;
    // Dataset changes preserve independently chosen execution/model settings.
    replace(
      healthcare
        ? {
            ...config,
            scenario: preset.scenario,
            roles: preset.roles,
            artifactSchemaVersion: preset.artifactSchemaVersion,
            reportSchemaVersion: preset.reportSchemaVersion,
            reportInstructions: preset.reportInstructions,
          }
        : { ...preset, label: config.label, experimentId: config.experimentId },
    );
  };
  const unavailable =
    catalog.error &&
    ((catalog.error as { status?: number }).status === 404 ||
      /route not found/i.test(catalog.error.message));
  const presetReady = catalog.data?.some(
    (item) =>
      item.datasetId === "fixture10-s101-points" && item.runtimeSupported,
  );
  const presetReason = catalog.loading
    ? "Checking the dataset catalog…"
    : unavailable
      ? "The dataset catalog isn't available in this workspace."
      : catalog.error
        ? "The dataset catalog couldn't be loaded."
        : !presetReady
          ? "The healthcare smoke dataset isn't installed in this workspace."
          : undefined;
  return { catalog, mutation, healthcare, selected, apply, unavailable, presetReady, presetReason };
}

/** The header "Start from" compound selector: current configuration or the healthcare smoke preset. */
export function PresetPicker({
  config,
  replace,
}: {
  config: ExperimentConfig;
  replace: (config: ExperimentConfig) => void;
}) {
  const { mutation, healthcare, apply, presetReady, presetReason } = useHealthcarePreset(config, replace);
  return (
    <>
      <span className="cf" title={presetReason}>
        <span>Start from</span>
        <select
          aria-label="Start from"
          value={healthcare ? "preset" : "current"}
          disabled={mutation.busy}
          onChange={(event) => {
            if (event.target.value === "preset") void apply("fixture10-s101-points");
          }}
        >
          <option value="current">Current configuration</option>
          <option value="preset" disabled={!presetReady && !healthcare}>
            Healthcare smoke preset
          </option>
        </select>
      </span>
      {mutation.error && <span className="field-error">{mutation.error.message}</span>}
    </>
  );
}

export function HealthcarePreset({
  config,
  replace,
  errors,
  showStart = true,
}: {
  config: ExperimentConfig;
  replace: (config: ExperimentConfig) => void;
  errors?: Record<string, string>;
  /** The "Use healthcare smoke preset" button; the editor shows the header selector instead. */
  showStart?: boolean;
}) {
  const { catalog, mutation, healthcare, selected, apply, unavailable, presetReady, presetReason } =
    useHealthcarePreset(config, replace);
  if (!showStart && !healthcare) return null;
  return (
    <div className="full stack">
      {showStart && !healthcare && (
        <div className="stack" style={{ gap: 6 }}>
          <Button
            variant="secondary"
            disabled={mutation.busy || !presetReady}
            aria-describedby={presetReason ? "healthcare-preset-reason" : undefined}
            onClick={() => void apply("fixture10-s101-points")}
          >
            Use healthcare smoke preset
          </Button>
          {presetReason && (
            <p className="helper" id="healthcare-preset-reason">
              {presetReason}
            </p>
          )}
        </div>
      )}
      {catalog.loading ? (
        <Loading />
      ) : unavailable ? (
        healthcare && (
          <p className="helper">
            Dataset catalog isn't available in this workspace.
          </p>
        )
      ) : catalog.error ? (
        <Notice kind="warning">
          Dataset catalog unavailable: {catalog.error.message}{" "}
          <Button variant="ghost" onClick={catalog.refresh}>
            Retry catalog
          </Button>
        </Notice>
      ) : healthcare ? (
        <>
          <Field
            label="Validated healthcare dataset"
            error={errors?.["scenario.datasetId"]}
            hint="Package assets and provenance are resolved by the server at launch."
          >
            <Select
              data-config-path="scenario.datasetId"
              value={selected?.datasetId ?? ""}
              disabled={mutation.busy}
              onChange={(event) => void apply(event.target.value)}
            >
              <option value="">Select an installed dataset</option>
              {catalog.data?.map((item) => (
                <option
                  key={item.datasetId + item.datasetVersion}
                  value={item.datasetId}
                  disabled={!item.runtimeSupported}
                >
                  {item.displayName} · v{item.datasetVersion} · N=
                  {item.panelSize}, K={item.topK} ·{" "}
                  {item.runtimeSupported ? "ready" : "runtime unavailable"}
                </option>
              ))}
            </Select>
          </Field>
          {selected ? (
            <p className="helper">
              Validation: {selected.validationStatus}. Runtime:{" "}
              {selected.runtimeSupported ? "supported" : "unavailable"}. Dataset
              changes preserve model, token and execution settings.
            </p>
          ) : (
            <Notice kind="warning">
              This dataset is not installed. Import the catalog before
              launch.
            </Notice>
          )}
        </>
      ) : (
        !catalog.data?.length && (
          <Notice kind="warning">
            No healthcare datasets installed. Run the documented dataset
            bootstrap command to enable the preset.
          </Notice>
        )
      )}
      {showStart && mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
    </div>
  );
}
