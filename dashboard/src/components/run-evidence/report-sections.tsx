import { humanizeKey, parseMaybeJson, ReadableValue } from "../readable-value";
import type { AgentActivity } from "./evidence-model";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** A final report as labelled sections (Own actions / Observations / Limitations ...), never minified JSON. */
export function ReportSections({
  parsed,
  raw,
}: {
  parsed: unknown;
  raw: string;
}) {
  const value = parseMaybeJson(parsed ?? raw);
  if (!isRecord(value) || !Object.keys(value).length)
    return <p className="text-block">{raw}</p>;
  return (
    <div className="report-sections">
      {Object.entries(value).map(([key, section]) => (
        <section key={key}>
          <h4>{humanizeKey(key)}</h4>
          {typeof section === "string" ? (
            <p className="text-block">{section}</p>
          ) : (
            <ReadableValue value={section} />
          )}
        </section>
      ))}
      <details>
        <summary className="helper">Exact submitted report text</summary>
        <pre className="rv-raw">{raw}</pre>
      </details>
    </div>
  );
}

/** Recorded event counts beside a report, so a reviewer can compare them with the report's own claims. */
export function ActivityStrip({
  agentId,
  activity,
  partial,
  loading,
}: {
  agentId: string;
  activity?: AgentActivity;
  partial: boolean;
  loading: boolean;
}) {
  if (loading && !activity)
    return <p className="helper">Loading recorded counts…</p>;
  const a: AgentActivity = activity ?? {
    roleDataReads: 0,
    boardPosts: 0,
    boardReads: 0,
    artifactUpdates: 0,
    archiveRequested: 0,
    archiveAdmitted: 0,
    memoryUpdates: 0,
  };
  const items: [string, string][] = [
    ["Role data reads", String(a.roleDataReads)],
    ["Board posts", String(a.boardPosts)],
    ["Board reads", String(a.boardReads)],
    ["Artifact updates", String(a.artifactUpdates)],
    [
      "Archive access",
      `${a.archiveRequested} requested / ${a.archiveAdmitted} admitted`,
    ],
    ["Memory updates", String(a.memoryUpdates)],
  ];
  return (
    <div className="activity-strip" aria-label={`Recorded for ${agentId}`}>
      <strong>Recorded for this agent</strong>
      <dl>
        {items.map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
      <span className="helper">
        Counts of recorded events for {agentId}
        {partial
          ? ` (partial: event history was capped, so counts are lower bounds)`
          : " (complete recorded event history)"}
        . The report's own statements are not parsed or verified here.
      </span>
    </div>
  );
}
