import * as React from "react";
import { pretty } from "../lib/utils";
import "./readable-value.css";

/**
 * Renders recorded JSON for people, not parsers.
 *
 * Long or multi-line strings (board posts, private notes, reports) render as
 * wrapped text with real line breaks under their key, instead of escaped JSON
 * with literal "\n". Objects become labelled rows; arrays of scalars become a
 * short list. A "Raw JSON" toggle always shows the exact recorded value.
 */

const PROSE_MIN_LENGTH = 80;

export function isProse(value: unknown): value is string {
  return typeof value === "string" && (value.length > PROSE_MIN_LENGTH || value.includes("\n"));
}

/** Parses a JSON string when it holds an object or array; otherwise returns the input unchanged. */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** Turns snake_case / camelCase keys into readable labels: "ownActions" → "Own actions". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="rv-null">null</span>;
  if (value === undefined) return <span className="rv-null">—</span>;
  if (typeof value === "string") {
    if (isProse(value)) return <div className="rv-prose">{value}</div>;
    return <span className="rv-string">{value === "" ? <span className="rv-null">empty</span> : value}</span>;
  }
  if (typeof value === "boolean") return <span className="rv-bool">{value ? "true" : "false"}</span>;
  return <span className="rv-number">{String(value)}</span>;
}

function isScalar(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== "object";
}

function ValueTree({ value, depth }: { value: unknown; depth: number }) {
  if (isScalar(value)) return <Scalar value={value} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="rv-null">empty list</span>;
    if (value.every((item) => isScalar(item) && !isProse(item))) {
      return (
        <span className="rv-inline-list">
          {value.map((item, index) => (
            <span key={index} className="rv-chip">
              <Scalar value={item} />
            </span>
          ))}
        </span>
      );
    }
    return (
      <ol className="rv-list">
        {value.map((item, index) => (
          <li key={index}>
            <ValueTree value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="rv-null">empty</span>;
  return (
    <dl className={depth === 0 ? "rv-rows" : "rv-rows rv-nested"}>
      {entries.map(([key, child]) => (
        <div key={key} className={isProse(child) || !isScalar(child) ? "rv-row rv-row-block" : "rv-row"}>
          <dt title={key}>{humanizeKey(key)}</dt>
          <dd>
            <ValueTree value={child} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReadableValue({
  value,
  rawLabel = "Raw JSON",
  defaultRaw = false,
  className,
}: {
  value: unknown;
  rawLabel?: string;
  defaultRaw?: boolean;
  className?: string;
}) {
  const parsed = React.useMemo(() => parseMaybeJson(value), [value]);
  const [raw, setRaw] = React.useState(defaultRaw);
  return (
    <div className={className ? `readable-value ${className}` : "readable-value"}>
      {raw ? <pre className="rv-raw">{pretty(parsed)}</pre> : <ValueTree value={parsed} depth={0} />}
      {!isScalar(parsed) && (
        <button type="button" className="rv-toggle" aria-pressed={raw} onClick={() => setRaw((r) => !r)}>
          {raw ? "Readable view" : rawLabel}
        </button>
      )}
    </div>
  );
}

/** One-line plain-text summary of a value, for compact rows (timeline). */
export function summarizeValue(value: unknown, max = 140): string {
  const parsed = parseMaybeJson(value);
  let text: string;
  if (typeof parsed === "string") text = parsed;
  else if (isScalar(parsed)) text = String(parsed);
  else if (Array.isArray(parsed)) text = parsed.map((item) => summarizeValue(item, max)).join(", ");
  else {
    const entries = Object.entries(parsed as Record<string, unknown>);
    const proseEntry = entries.find(([, child]) => isProse(child));
    text = proseEntry
      ? String(proseEntry[1])
      : entries.map(([key, child]) => `${humanizeKey(key)}: ${isScalar(child) ? String(child) : "…"}`).join(" · ");
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}
