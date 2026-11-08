import { Field, Input, Select, Textarea } from "../../components/ui";
import { HealthcarePreset } from "../../components/healthcare-preset";
import type { ExperimentConfig, Json } from "../../lib/types";
import { useScenarios } from "../../lib/descriptors";
import { readableName, primitiveAssets } from "./config-edit";
import type { ConfigFieldFactory } from "./config-field";
import { Section } from "./section";
import type { SectionState } from "./sections";

/** Scenario & data section. Healthcare preset and dataset fields stay scenario-aware. */
export function ScenarioSection({
  config,
  change,
  replace,
  notes,
  editNotes,
  field,
  errors,
  state,
}: {
  config: ExperimentConfig;
  change(path: string, value: unknown): void;
  replace(value: ExperimentConfig): void;
  notes: string;
  editNotes(value: string): void;
  field: ConfigFieldFactory;
  errors: Record<string, string> | undefined;
  state: SectionState;
}) {
  const scenarios = useScenarios();
  const showDatasetFields = scenarios.view(config.scenario.version).showDatasetFields;
  const assets = primitiveAssets(config);
  /** Healthcare supplies the task and policy; they are shown, not edited. */
  const supplied = !showDatasetFields;
  const frozen = supplied ? "Supplied by the scenario, frozen at launch." : undefined;
  return (
    <Section
      state={state}
      description="Versioned scenario and study metadata. The task and policy are frozen at launch."
    >
      <div className="two">
        {field("label", "Experiment name")}
        {field("experimentId", "Experiment / group identifier")}
      </div>
      <div className="three">
        {field("scenario.version", "Scenario version")}
        {field("configVersion", "Configuration version")}
        <Field label="Designation">
          <Select
            value={config.phase}
            onChange={(e) => change("phase", e.target.value)}
          >
            <option value="development">Development / fixture</option>
            <option value="pilot">Pilot</option>
            <option value="study">Study</option>
          </Select>
        </Field>
      </div>
      <HealthcarePreset config={config} replace={replace} errors={errors} showStart={false} />
      {showDatasetFields && (
        <div className="three">
          {field("scenario.datasetId", "Dataset identifier")}
          {field("scenario.datasetVersion", "Dataset version")}
          {field("scenario.datasetSeed", "Dataset seed", undefined, "number")}
        </div>
      )}
      {field("scenario.task", "Task", frozen, "textarea", undefined, supplied)}
      {field("scenario.policy", "Policy", frozen, "textarea", undefined, supplied)}
      <Field
        label="Research notes (optional)"
        hint="Draft metadata only; these notes are not delivered to agents."
      >
        <Textarea value={notes} onChange={(e) => editNotes(e.target.value)} />
      </Field>
      {showDatasetFields && (
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <h3>Scenario assets</h3>
            <p className="small muted">
              Synthetic fixture fields are editable below. Structured scenario
              assets are retained and require a supported scenario form.
            </p>
          </div>
          {assets ? (
            <div className="three">
              {assets.map(([key, value]) => (
                <Field key={key} label={readableName(key)}>
                  {typeof value === "string" || typeof value === "number" ? (
                    <Input
                      type={typeof value === "number" ? "number" : "text"}
                      value={value}
                      onChange={(e) =>
                        change("scenario.assets", {
                          ...(config.scenario.assets as Record<string, Json>),
                          [key]:
                            typeof value === "number"
                              ? e.target.valueAsNumber
                              : e.target.value,
                        })
                      }
                    />
                  ) : typeof value === "boolean" ? (
                    <Select
                      value={String(value)}
                      onChange={(e) =>
                        change("scenario.assets", {
                          ...(config.scenario.assets as Record<string, Json>),
                          [key]: e.target.value === "true",
                        })
                      }
                    >
                      <option>true</option>
                      <option>false</option>
                    </Select>
                  ) : (
                    <p className="small muted">
                      Unsupported structured asset field. Preserved in
                      configuration: {key}.
                    </p>
                  )}
                </Field>
              ))}
            </div>
          ) : (
            <p className="small muted">
              This scenario uses a structured asset schema without a registered
              editor. Existing assets are preserved; choose a supported scenario
              draft to change them.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
