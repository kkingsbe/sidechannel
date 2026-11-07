import type { ComponentType } from "react";
import { JsonView, Table } from "./ui";
import { pretty } from "../lib/utils";
type ArtifactRenderer = ComponentType<{ value: unknown }>;
/** Scenario renderers are registered in source, never supplied as executable scenario code. */
const artifactRenderers: Record<string, ArtifactRenderer> = {
  "healthcare-points-v0.3": HealthcareArtifact,
};
function HealthcareArtifact({ value }: { value: unknown }) {
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
    return <p>No ranking entries submitted. This artifact is incomplete.</p>;
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
  scenarioVersion,
}: {
  value: unknown;
  scenarioVersion?: string;
}) {
  // Scenario renderers are keyed by the scenario version that produced the
  // artifact. There is deliberately no `kind@schemaVersion` fallback: it was
  // never registered, so the lookup was half-wired and only added ambiguity.
  const Renderer = artifactRenderers[scenarioVersion ?? ""];
  return Renderer ? (
    <Renderer value={value} />
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
                    <span className="text-block">
                      {pretty((item as Record<string, unknown>)[key])}
                    </span>
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
    return <JsonView value={value} title="Recorded artifact values" />;
  }
  if (value && typeof value === "object")
    return (
      <dl className="definition-list">
        {Object.entries(value).map(([key, child]) => (
          <div key={key} style={{ display: "contents" }}>
            <dt>{key}</dt>
            <dd>
              {child && typeof child === "object" ? (
                <JsonView value={child} title={key + " · recorded structure"} />
              ) : (
                <span className="text-block">{pretty(child)}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  return <p className="text-block">{pretty(value)}</p>;
}
