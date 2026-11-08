import type { ComponentType } from "react";
import { Table } from "./ui";
import { pretty } from "../lib/utils";
import { ReadableValue } from "./readable-value";
import { scenarioView } from "../lib/descriptors";
type ArtifactRenderer = ComponentType<{ value: unknown; terminal: boolean }>;
/** Artifact renderers are keyed by the artifact schema version a scenario declares, never by its scenario version. */
const artifactRenderers: Record<string, ArtifactRenderer> = {
  "healthcare-ranking-v0.3": HealthcareArtifact,
};
function HealthcareArtifact({
  value,
  terminal,
}: {
  value: unknown;
  terminal: boolean;
}) {
  const entries =
    value && typeof value === "object" && "entries" in value
      ? value.entries
      : undefined;
  if (
    !Array.isArray(entries) ||
    !entries.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.case_key === "string" &&
        typeof entry.rank === "number" &&
        typeof entry.uncertain === "boolean" &&
        typeof entry.note === "string",
    )
  ) {
    return (
      <>
        <p role="alert">The recorded ranking has an invalid structure.</p>
        <StructuredData value={value} />
      </>
    );
  }
  if (!entries.length)
    return terminal ? (
      <p>No ranking entries submitted. This artifact is incomplete.</p>
    ) : (
      <p>No submission yet.</p>
    );
  return (
    <Table
      label="Healthcare ranked cases"
      headers={["Rank", "Case key", "Uncertain", "Note"]}
    >
      {entries.map((entry, index) => (
        <tr key={index}>
          <td className="num">{entry.rank}</td>
          <td className="mono" style={{ whiteSpace: "nowrap" }}>{entry.case_key}</td>
          <td>{entry.uncertain ? "Yes" : "No"}</td>
          <td className="text-block">{entry.note || "—"}</td>
        </tr>
      ))}
    </Table>
  );
}
export function ArtifactView({
  value,
  schemaVersion,
  scenarioVersion,
  artifactSchemaVersion,
  terminal = true,
}: {
  value: unknown;
  /** Artifact schema version (descriptor-driven). `artifactSchemaVersion` is the WS5-era alias. */
  schemaVersion?: string;
  scenarioVersion?: string;
  artifactSchemaVersion?: string;
  /** False while the run can still change the artifact: an empty value then means "no submission yet". */
  terminal?: boolean;
}) {
  const kind =
    value && typeof value === "object" && !Array.isArray(value)
      ? String((value as Record<string, unknown>).kind ?? "generic")
      : "generic";
  const schema = schemaVersion ?? artifactSchemaVersion ?? "";
  // The dashboard-owned scenario descriptors know which artifact schema a scenario declares, so a run
  // stored before the schema field was populated (or a fixture config selecting the healthcare
  // scenario) still renders with its scenario renderer. Renderers are keyed by artifact schema
  // version, never by a scenario-version literal.
  const scenarioSchema = scenarioVersion ? scenarioView(scenarioVersion, []).artifactSchemaVersion : "";
  const Renderer =
    (schema ? artifactRenderers[schema] : undefined) ??
    (scenarioSchema ? artifactRenderers[scenarioSchema] : undefined);
  return Renderer ? (
    <Renderer value={value} terminal={terminal} />
  ) : (
    <StructuredData value={value} />
  );
}
function StructuredData({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    const records = value.every(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );
    if (records && value.length) {
      const keys = [
        ...new Set(value.flatMap((item) => Object.keys(item as object))),
      ];
      return (
        <>
          <Table label="Recorded artifact rows" headers={keys}>
            {value.slice(0, 20).map((item, index) => (
              <tr key={index}>
                {keys.map((key) => (
                  <td key={key}>
                    <CellValue value={(item as Record<string, unknown>)[key]} />
                  </td>
                ))}
              </tr>
            ))}
          </Table>
          {value.length > 20 && (
            <p className="helper">
              First 20 of {value.length} recorded rows. Inspect this version for
              the complete artifact.
            </p>
          )}
        </>
      );
    }
    return <ReadableValue value={value} />;
  }
  if (value && typeof value === "object") return <ReadableValue value={value} />;
  return <p className="text-block">{pretty(value)}</p>;
}
function CellValue({ value }: { value: unknown }) {
  return value && typeof value === "object" ? (
    <ReadableValue value={value} />
  ) : (
    <span className="text-block">{pretty(value)}</span>
  );
}
