import { useMemo } from "react";

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

export function DiffView({
  before,
  after,
  label = "Changes",
}: {
  before: string;
  after: string;
  label?: string;
}) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  if (!lines.some((line) => line.kind !== "same"))
    return <p className="helper">No differences.</p>;
  return (
    <div className="line-diff" role="group" aria-label={label}>
      {lines.map((line, index) => (
        <div key={index} className={"line-diff-" + line.kind}>
          <span className="line-diff-mark" aria-hidden="true">
            {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
          </span>
          <span className="line-diff-text">
            {line.kind === "added" && <span className="sr-only">Added: </span>}
            {line.kind === "removed" && (
              <span className="sr-only">Removed: </span>
            )}
            {line.text || " "}
          </span>
        </div>
      ))}
    </div>
  );
}
