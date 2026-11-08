import { humanizeKey, parseMaybeJson, ReadableValue } from "../readable-value";
import "./run-evidence.css";
import { leadPhrase, sentenceCase, splitHeaded, splitNumbered } from "./structure";
import type { AgentActivity } from "./evidence-model";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const SECTION_ORDER = ["limitations", "observations", "ownActions", "own_actions"];

/** Numbered points ("(1) ... (2) ..." or ALL-CAPS headings) as an ordered list with the leading phrase in 500. */
function Points({ text }: { text: string }) {
  const numbered = splitNumbered(text);
  const headed = splitHeaded(text).filter((segment) => segment.key);
  const items =
    numbered && numbered.length > 1
      ? numbered.map((point) => leadPhrase(point))
      : headed.length > 1
        ? headed.map((segment) => ({ lead: sentenceCase(segment.key) + ".", rest: segment.body }))
        : undefined;
  if (!items) return <Paragraphs text={text} />;
  return (
    <ol>
      {items.map((item, index) => (
        <li key={index}>
          {item.lead && <b>{item.lead}</b>} {item.rest}
        </li>
      ))}
    </ol>
  );
}

/** Prose as paragraphs; when it carries ALL-CAPS headings each becomes a paragraph led by its heading. */
function Paragraphs({ text }: { text: string }) {
  const headed = splitHeaded(text);
  if (headed.filter((segment) => segment.key).length > 1)
    return (
      <>
        {headed.map((segment, index) => (
          <p key={index}>
            {segment.key && <b>{sentenceCase(segment.key)}.</b>} {segment.body}
          </p>
        ))}
      </>
    );
  return (
    <>
      {text
        .split(/\n+/)
        .filter(Boolean)
        .map((line, index) => (
          <p key={index}>{line}</p>
        ))}
    </>
  );
}

const pointCount = (text: string) => {
  const numbered = splitNumbered(text);
  if (numbered && numbered.length > 1) return numbered.length;
  const headed = splitHeaded(text).filter((segment) => segment.key);
  return headed.length > 1 ? headed.length : undefined;
};

/** The sections of a parsed report in reading order: limitations, observations, own actions, then anything else. */
export function reportSections(parsed: unknown, raw: string) {
  const value = parseMaybeJson(parsed ?? raw);
  if (!isRecord(value) || !Object.keys(value).length) return undefined;
  const keys = Object.keys(value).sort((a, b) => {
    const rank = (key: string) => {
      const index = SECTION_ORDER.indexOf(key);
      return index < 0 ? SECTION_ORDER.length : index;
    };
    return rank(a) - rank(b);
  });
  return keys.map((key) => ({ key, section: value[key] }));
}

/** A final report as labelled sections (Limitations / Observations / Own actions ...), never minified JSON. */
export function ReportSections({
  parsed,
  raw,
  mode = "readable",
}: {
  parsed: unknown;
  raw: string;
  mode?: "readable" | "exact";
}) {
  const sections = reportSections(parsed, raw);
  if (mode === "exact") return <pre className="ev-exact">{raw || "(no text recorded)"}</pre>;
  if (!sections) return <p className="text-block">{raw || "No report text was recorded."}</p>;
  return (
    <div className="ev-report-body">
      {sections.map(({ key, section }) => {
        const count = typeof section === "string" && /limitation/i.test(key) ? pointCount(section) : undefined;
        return (
          <div key={key} className="ev-report-sec">
            <h3>
              {humanizeKey(key)}
              {count !== undefined && <span className="muted"> · {count}</span>}
            </h3>
            {typeof section !== "string" ? (
              <ReadableValue value={section} />
            ) : /limitation/i.test(key) ? (
              <Points text={section} />
            ) : (
              <Paragraphs text={section} />
            )}
          </div>
        );
      })}
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
