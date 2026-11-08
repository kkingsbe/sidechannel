import { Card, CardHeading } from "../../components/ui";
import type { ConfigFieldFactory } from "./config-field";

/** Artifact & report settings section, collapsed by default. */
export function ArtifactReportSection({ field }: { field: ConfigFieldFactory }) {
  return (
    <details className="experiment-details form-section">
      <summary>Artifact & report settings</summary>
      <Card className="form-section">
        <CardHeading title="Final artifact & reports" />
        <div className="card-body form-grid">
          {field("artifactSchemaVersion", "Artifact schema version")}
          {field("reportSchemaVersion", "Report schema version")}
          <div className="full">
            {field(
              "reportInstructions",
              "Reporting instructions",
              undefined,
              "textarea",
            )}
          </div>
        </div>
      </Card>
    </details>
  );
}
