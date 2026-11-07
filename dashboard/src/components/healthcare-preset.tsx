import type { DatasetCatalogItem } from "@sidechannel/contracts/browser";
import type { ExperimentConfig } from "../lib/types";
import { useApi, useMutation } from "../lib/api";
import { useScenarios } from "../lib/descriptors";
import { useClients } from "../lib/clients/context";
import { Button, Field, Loading, Notice, Select } from "./ui";

export function HealthcarePreset({
  config,
  replace,
  errors,
}: {
  config: ExperimentConfig;
  replace: (config: ExperimentConfig) => void;
  errors?: Record<string, string>;
}) {
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
  return (
    <div className="full stack">
      {!healthcare && (
        <Button
          variant="secondary"
          disabled={
            mutation.busy ||
            !catalog.data?.some(
              (item) =>
                item.datasetId === "fixture10-s101-points" &&
                item.runtimeSupported,
            )
          }
          onClick={() => void apply("fixture10-s101-points")}
        >
          Use healthcare smoke preset
        </Button>
      )}
      {catalog.loading ? (
        <Loading />
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
            hint="Canonical package assets and provenance are resolved by the server at launch."
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
              This dataset is not installed. Import the canonical catalog before
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
      {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
    </div>
  );
}
