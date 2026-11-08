import type { ExperimentConfig } from "../../lib/types";
import type { ConfigFieldFactory } from "./config-field";
import { Section } from "./section";
import type { SectionState } from "./sections";

/** Artifact & report settings: current values, with the fields behind an "Edit" disclosure. */
export function ArtifactReportSection({
  config,
  field,
  state,
}: {
  config: ExperimentConfig;
  field: ConfigFieldFactory;
  state: SectionState;
}) {
  const instructions = config.reportInstructions ?? "";
  return (
    <Section
      state={state}
      description="Schema versions and the instruction each agent follows for its final report."
    >
      <dl className="kv exp-kv">
        <dt>Artifact schema</dt>
        <dd>{config.artifactSchemaVersion}</dd>
        <dt>Report schema</dt>
        <dd>{config.reportSchemaVersion}</dd>
        <dt>Report instructions</dt>
        <dd className="exp-clamp">{instructions || "None"}</dd>
      </dl>
      <details className="exp-edit">
        <summary className="link">Edit reports &amp; artifact settings</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="two">
            {field("artifactSchemaVersion", "Artifact schema version")}
            {field("reportSchemaVersion", "Report schema version")}
          </div>
          {field("reportInstructions", "Reporting instructions", undefined, "textarea")}
        </div>
      </details>
    </Section>
  );
}
