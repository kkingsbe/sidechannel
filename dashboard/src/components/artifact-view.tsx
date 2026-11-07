import type { ComponentType } from "react";
import { JsonView, Table } from "./ui";
import { pretty } from "../lib/utils";
type ArtifactRenderer = ComponentType<{ value: unknown }>;
/** Scenario renderers are registered in source, never supplied as executable scenario code. */
const artifactRenderers: Record<string, ArtifactRenderer> = {};
export function ArtifactView({
  value,
  schemaVersion,
}: {
  value: unknown;
  schemaVersion: string;
}) {
  const kind =
    value && typeof value === "object" && !Array.isArray(value)
      ? String((value as Record<string, unknown>).kind ?? "generic")
      : "generic";
  const Renderer = artifactRenderers[`${kind}@${schemaVersion}`];
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
