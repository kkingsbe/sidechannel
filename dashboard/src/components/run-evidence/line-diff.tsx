import { useMemo } from "react";
import "./run-evidence.css";

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** Simple line-based diff (longest common subsequence). Large inputs fall back to a set comparison. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  if (a.length * b.length > 250_000) {
    const old = new Set(a);
    const next = new Set(b);
    return [
      ...a
        .filter((line) => !next.has(line))
        .map((text) => ({ kind: "removed" as const, text })),
      ...b.map((text) => ({
        kind: old.has(text) ? ("same" as const) : ("added" as const),
        text,
      })),
    ];
  }
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!)
      result.push({ kind: "removed", text: a[i++]! });
    else result.push({ kind: "added", text: b[j++]! });
  }
  while (i < a.length) result.push({ kind: "removed", text: a[i++]! });
  while (j < b.length) result.push({ kind: "added", text: b[j++]! });
  return result;
}

/** Few long lines (a one-paragraph note) diff better by sentence; many short lines stay as they are. */
export function unitize(text: string): string {
  const lines = text.split("\n");
  if (lines.length >= 8) return text;
  return lines
    .flatMap((line) => line.split(/(?<=[.;!?]) +(?=[A-Z(])/))
    .join("\n");
}

const TAGS = { added: "added", removed: "removed", same: "kept" } as const;

/**
 * Only the changed lines, each with a removed/added pill and pale red/green text. The unchanged lines
 * collapse into one "kept" row; `full` shows the complete diff instead.
 */
export function DiffView({
  before,
  after,
  label = "Changes",
  full = false,
}: {
  before: string;
  after: string;
  label?: string;
  full?: boolean;
}) {
  const lines = useMemo(
    () => diffLines(unitize(before), unitize(after)),
    [before, after],
  );
  if (!lines.some((line) => line.kind !== "same"))
    return <p className="helper">No differences.</p>;
  if (full)
    return (
      <div className="ev-diff-full" role="group" aria-label={label}>
        {lines.map((line, index) => (
          <div key={index} className={"ev-d-" + line.kind}>
            <span aria-hidden="true" style={{ width: "1ch", flex: "none" }}>
              {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
            </span>
            <span>
              {line.kind !== "same" && (
                <span className="sr-only">{line.kind === "added" ? "Added: " : "Removed: "}</span>
              )}
              {line.text || " "}
            </span>
          </div>
        ))}
      </div>
    );
  const changed = lines.filter((line) => line.kind !== "same");
  const kept = lines.length - changed.length;
  return (
    <div className="ev-diff" role="group" aria-label={label}>
      {changed.map((line, index) => (
        <div key={index} className="ev-change">
          <span className={"ev-tag ev-tag-" + line.kind} style={{ justifySelf: "start" }}>
            {TAGS[line.kind]}
          </span>
          <span className={"ev-change-text ev-change-" + line.kind}>{line.text}</span>
        </div>
      ))}
      {kept > 0 && (
        <div className="ev-change">
          <span className="ev-tag" style={{ justifySelf: "start" }}>
            kept
          </span>
          <span className="ev-change-text ev-change-kept">
            {kept} unchanged {kept === 1 ? "line" : "lines"}.
          </span>
        </div>
      )}
    </div>
  );
}
