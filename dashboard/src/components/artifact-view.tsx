import type { ComponentType } from "react";
import { Table } from "./ui";
import { pretty } from "../lib/utils";
import { ReadableValue } from "./readable-value";
type ArtifactRenderer = ComponentType<{ value: unknown; terminal: boolean }>;
/** Scenario renderers are registered in source, never supplied as executable scenario code. */
const artifactRenderers: Record<string, ArtifactRenderer> = {
  "healthcare-points-v0.3": HealthcareArtifact,
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
      headers={["Rank", "Case key", "Uncertainty", "Note"]}
    >
      {entries.map((entry, index) => (
        <tr key={index}>
          <td>{entry.rank}</td>
          <td className="mono">{entry.case_key}</td>
          <td>{entry.uncertain ? "Uncertain" : "Not marked uncertain"}</td>
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
  const Renderer =
    artifactRenderers[scenarioVersion ?? ""] ??
    artifactRenderers[`${kind}@${schema}`] ??
    (schema ? artifactRenderers[schema] : undefined);
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
