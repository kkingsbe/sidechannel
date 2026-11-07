import { Card, CardHeading, Field, Input, Notice, Select, Textarea } from "../../components/ui";
import { HealthcarePreset } from "../../components/healthcare-preset";
import type { ExperimentConfig, Json } from "../../lib/types";
import { readableName, primitiveAssets } from "./config-edit";
import type { ConfigFieldFactory } from "./config-field";

/** Scenario & data section. Healthcare preset and dataset fields stay scenario-aware. */
export function ScenarioSection({
  config,
  change,
  replace,
  notes,
  editNotes,
  field,
  errors,
}: {
  config: ExperimentConfig;
  change(path: string, value: unknown): void;
  replace(value: ExperimentConfig): void;
  notes: string;
  editNotes(value: string): void;
  field: ConfigFieldFactory;
  errors: Record<string, string> | undefined;
}) {
  const assets = primitiveAssets(config);
  return (
    <Card className="form-section">
      <CardHeading
        title="Scenario & data"
        description="Versioned scenario and study metadata"
      />
      <div className="card-body form-grid">
        <HealthcarePreset config={config} replace={replace} errors={errors} />
        {field("label", "Experiment name")}
        {field("experimentId", "Experiment / group identifier")}
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
        {field("scenario.version", "Scenario version")}
        {config.scenario.version !== "healthcare-points-v0.3" && (
          <>
            {field("scenario.datasetId", "Dataset identifier")}
            {field("scenario.datasetVersion", "Dataset version")}
            {field(
              "scenario.datasetSeed",
              "Dataset seed",
              undefined,
              "number",
            )}
          </>
        )}
        <div className="full">
          {field(
            "scenario.task",
            "Task",
            "This supported scenario supplies the task; it is frozen at launch.",
            "textarea",
          )}
        </div>
        <div className="full">
          {field("scenario.policy", "Policy", undefined, "textarea")}
        </div>
        <Field
          label="Research notes"
          className="full"
          hint="Draft metadata only; these notes are not delivered to agents."
        >
          <Textarea value={notes} onChange={(e) => editNotes(e.target.value)} />
        </Field>
        {config.scenario.version !== "healthcare-points-v0.3" && (
          <>
            <div className="full">
              <h3>Scenario assets</h3>
              <p className="helper">
                Synthetic fixture fields are editable below. Structured scenario
                assets are retained and require a supported scenario form.
              </p>
            </div>
            {assets ? (
              assets.map(([key, value]) => (
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
                    <Notice kind="warning">
                      Unsupported structured asset field. Preserved in
                      configuration: {key}.
                    </Notice>
                  )}
                </Field>
              ))
            ) : (
              <Notice kind="warning">
                This scenario uses a structured asset schema without a
                registered editor. Existing assets are preserved; choose a
                supported scenario draft to change them.
              </Notice>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
