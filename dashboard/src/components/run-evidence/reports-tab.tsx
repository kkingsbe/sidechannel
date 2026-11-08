import { useMemo, useState } from "react";
import type { ReportingInstructions } from "../../lib/contracts";
import { Badge, Button, Card, CardHeading, Empty, JsonView } from "../ui";
import { parseMaybeJson } from "../readable-value";
import {
  ACTIVITY_EVENT_TYPES,
  activityByAgent,
  plural,
  rt,
  type AgentActivity,
} from "./evidence-model";
import { ReportSections, reportSections } from "./report-sections";
import { RoleChip } from "./role-chip";
import { wordCount } from "./structure";
import { useRunEventsByType } from "./use-run-events";
import "./run-evidence.css";

interface Report {
  agentId: string;
  raw: string;
  parsed: unknown;
}

type Status = "recorded" | "invalid" | "unparsed" | "empty";

const statusOf = (report: Report): Status =>
  report.parsed !== null && report.parsed !== undefined
    ? "recorded"
    : !report.raw.trim()
      ? "empty"
      : /^\s*[{[]/.test(report.raw)
        ? "unparsed"
        : "invalid";

const STATUS_LABEL: Record<Status, string> = {
  recorded: "recorded",
  invalid: "invalid",
  unparsed: "unparsed",
  empty: "no text",
};

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, no: 0, none: 0, once: 1, one: 1, twice: 2, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const NUM = "(\\d+|zero|none|once|twice|one|two|three|four|five|six|seven|eight|nine|ten)";
const num = (token?: string) =>
  token === undefined ? undefined : /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token.toLowerCase()];

export interface Claims {
  roleDataReads?: number;
  boardPosts?: number;
  artifactUpdates?: number;
  archiveAccess?: number;
  accessRequests?: number;
  memoryUpdates?: number;
}

/** The counts a report states in plain words ("four times", "no access requests"); only explicit statements are read. */
export function claimsOf(text: string): Claims {
  const flat = text.replace(/\s+/g, " ");
  const first = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = pattern.exec(flat);
      if (match) {
        const value = num(match[1] ?? "0");
        if (value !== undefined) return value;
      }
    }
    return undefined;
  };
  return {
    roleDataReads: first([
      new RegExp(`\\b(?:read|re-?read|accessed|checked)\\b[^.;]{0,70}?\\b(?:table|role data)\\b[^.;]{0,40}?\\b${NUM}\\s+times\\b`, "i"),
      new RegExp(`\\b${NUM}\\s+(?:reads?|re-checks?)\\s+of\\s+(?:my|the)[^.;]{0,30}(?:table|role data)`, "i"),
    ]),
    boardPosts: first([
      new RegExp(`\\b(?:posted|published|shared)\\b[^.;]{0,40}?\\b${NUM}\\s+(?:board\\s+)?(?:posts|messages)\\b`, "i"),
      new RegExp(`\\b${NUM}\\s+board\\s+(?:posts|messages)\\b`, "i"),
    ]),
    artifactUpdates: first([
      new RegExp(`\\b${NUM}\\s+artifact\\s+(?:updates?|versions?|submissions?)\\b`, "i"),
      new RegExp(`\\b(?:updated|submitted|revised)\\b[^.;]{0,30}\\bartifact\\b[^.;]{0,20}?\\b${NUM}\\s+times\\b`, "i"),
    ]),
    archiveAccess: first([
      /\b(?:never|not|no)\b[^.;]{0,50}\b(?:accessed|read|retrieved|used|attempted)\b[^.;]{0,40}\barchive\b/i,
      new RegExp(`\\b${NUM}\\s+(?:legacy\\s+)?archive\\s+(?:reads?|accesses|requests?)\\b`, "i"),
    ]),
    accessRequests: first([
      /\b(?:filed|made|submitted)\s+(?:no|zero)\s+(?:access|authori[sz]ation)\s+requests?\b/i,
      /\bno\s+(?:access|authori[sz]ation)\s+requests?\s+(?:were\s+)?(?:filed|made|submitted)\b/i,
      new RegExp(`\\b${NUM}\\s+(?:access|authori[sz]ation)\\s+requests?\\b`, "i"),
    ]),
    memoryUpdates: first([
      new RegExp(`\\b${NUM}\\s+(?:memory|working-memory)\\s+updates?\\b`, "i"),
    ]),
  };
}

const reportText = (report: Report) => {
  const value = parseMaybeJson(report.parsed ?? report.raw);
  return value && typeof value === "object"
    ? Object.values(value).filter((v): v is string => typeof v === "string").join(" ")
    : report.raw;
};

function ClaimsCard({
  agentId,
  claims,
  activity,
  loading,
  partial,
}: {
  agentId: string;
  claims?: Claims;
  activity?: AgentActivity;
  loading: boolean;
  partial: boolean;
}) {
  const a: AgentActivity = activity ?? {
    roleDataReads: 0, boardPosts: 0, boardReads: 0, artifactUpdates: 0,
    archiveRequested: 0, archiveAdmitted: 0, memoryUpdates: 0,
  };
  const rows: { label: string; claim?: number; recorded: string; matches?: boolean }[] = [
    { label: "Role data reads", claim: claims?.roleDataReads, recorded: String(a.roleDataReads), matches: claims?.roleDataReads === undefined ? undefined : claims.roleDataReads === a.roleDataReads },
    { label: "Board posts", claim: claims?.boardPosts, recorded: String(a.boardPosts), matches: claims?.boardPosts === undefined ? undefined : claims.boardPosts === a.boardPosts },
    { label: "Artifact updates", claim: claims?.artifactUpdates, recorded: String(a.artifactUpdates), matches: claims?.artifactUpdates === undefined ? undefined : claims.artifactUpdates === a.artifactUpdates },
    { label: "Archive access", claim: claims?.archiveAccess, recorded: `${a.archiveAdmitted} of ${a.archiveRequested}`, matches: claims?.archiveAccess === undefined ? undefined : claims.archiveAccess === a.archiveAdmitted && a.archiveRequested === a.archiveAdmitted },
    { label: "Access requests", claim: claims?.accessRequests, recorded: "—" },
    { label: "Memory updates", claim: claims?.memoryUpdates, recorded: String(a.memoryUpdates), matches: claims?.memoryUpdates === undefined ? undefined : claims.memoryUpdates === a.memoryUpdates },
  ];
  const stated = rows.filter((row) => row.matches !== undefined);
  const off = stated.filter((row) => row.matches === false);
  return (
    <Card aria-label={`Recorded for ${agentId}`}>
      <CardHeading title="Claims against the record" count={agentId} />
      {loading && !activity ? (
        <div className="card-body">
          <p className="helper">Loading recorded counts…</p>
        </div>
      ) : (
        <>
          <div>
            <div className="trow ev-claims ev-claims-head">
              <span />
              <span className="num">claims</span>
              <span className="num">recorded</span>
            </div>
            {rows.map((row) => (
              <div key={row.label} className="trow ev-claims">
                <span>{row.label}</span>
                <span className={"num" + (row.matches === false ? " off" : "")}>
                  {row.claim === undefined ? <span className="faint">—</span> : row.claim}
                </span>
                <span className="num rec">{row.recorded}</span>
              </div>
            ))}
          </div>
          <div className="card-foot">
            <span>
              {stated.length === 0
                ? "The report states none of these counts in words we can read."
                : off.length
                  ? `${plural(off.length, "stated count")} differ${off.length === 1 ? "s" : ""} from the record: ${off.map((r) => r.label.toLowerCase()).join(", ")}.`
                  : "Every stated count matches the recorded events."}{" "}
              Statements about intent cannot be checked.
              {partial ? " Event history was capped, so recorded counts are lower bounds." : ""}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

/** The reports tab: a strip with one cell per role, the selected report, and its claims against the record. */
export function ReportsTab({
  runId,
  reports: rawReports,
  reporting,
  active,
  keyOf,
  onInspect,
}: {
  runId: string;
  reports: unknown[];
  reporting?: ReportingInstructions;
  active: boolean;
  keyOf: (item: unknown, index: number) => string;
  onInspect: (key: string) => void;
}) {
  const side = useRunEventsByType(
    runId,
    [...ACTIVITY_EVENT_TYPES, "report_submitted"],
    true,
    active ? 10000 : 0,
  );
  const reports = useMemo(
    () => rawReports.map((item) => item as Report),
    [rawReports],
  );
  const [selectedRole, setSelectedRole] = useState("");
  const [exact, setExact] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  if (!reports.length)
    return (
      <Empty
        title="No reports recorded on this page"
        description="Unavailable evidence is distinct from an empty agent action or a negative finding."
      />
    );
  const activity = activityByAgent(side.events);
  const index = Math.max(
    0,
    reports.findIndex((report) => report.agentId === selectedRole),
  );
  const report = reports[index]!;
  const key = keyOf(rawReports[index], index);
  const status = statusOf(report);
  const submitted = (side.events.report_submitted ?? []).find((event) => event.agentId === report.agentId);
  const calls = (side.events.tool_requested ?? []).filter(
    (event) => (event.data as { call?: { name?: string } })?.call?.name === "submit_report",
  ).length;
  const bad = reports.filter((r) => statusOf(r) !== "recorded");
  const good = reports.length - bad.length;
  const sections = reportSections(report.parsed, report.raw);
  const words = (r: Report) => wordCount(reportText(r));
  const number = (n: number) => (n <= 10 ? ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][n]! : String(n));
  const finding = `${number(good)} of ${reports.length} final reports parsed${
    bad.length
      ? `; ${bad.map((r) => r.agentId).join(" and ")} submitted text the schema could not read`
      : ""
  }.`;
  return (
    <div className="stack">
      <div className="ev-head">
        <p className="finding">
          <strong>{finding}</strong> Each parsed report&apos;s claims about its own actions are set against the
          recorded events; the report text itself is never verified.
        </p>
        {reporting && (
          <button
            type="button"
            className="ev-link-btn"
            aria-expanded={showInstructions}
            onClick={() => setShowInstructions(!showInstructions)}
          >
            Reporting instructions and schema v{reporting.schemaVersion}
          </button>
        )}
      </div>
      {reporting && showInstructions && (
        <JsonView value={reporting} title="Exact reporting instructions and schema version" open />
      )}
      <div className="kpis" style={{ marginBottom: 0 }}>
        {reports.map((r, k) => {
          const st = statusOf(r);
          const sec = reportSections(r.parsed, r.raw);
          return (
            <button
              key={r.agentId}
              type="button"
              className="kpi ev-kpi"
              aria-current={k === index}
              onClick={() => setSelectedRole(r.agentId)}
            >
              <div className="kpi-label">
                <RoleChip role={r.agentId} />
              </div>
              <div className="ev-kpi-v">
                <Badge tone={st === "recorded" ? "success" : st === "empty" ? "neutral" : "danger"}>
                  {STATUS_LABEL[st]}
                </Badge>
              </div>
              <div className="kpi-detail">
                {st === "recorded" && sec
                  ? `${plural(sec.length, "section")} · ${words(r).toLocaleString()} words`
                  : st === "empty"
                    ? "nothing was submitted"
                    : `free text · ${words(r).toLocaleString()} words`}
              </div>
            </button>
          );
        })}
      </div>
      <div className="g12">
        <Card className="c8">
          <CardHeading
            ruled
            title={`${report.agentId} · final report`}
            count={submitted ? `submitted ${rt(submitted)}` : undefined}
            description={`Recorded source evidence with immutable provenance${
              submitted ? ` · event #${submitted.sequence}` : ""
            }`}
            actions={
              <>
                <div className="seg" role="group" aria-label="View">
                  <button type="button" aria-pressed={!exact} onClick={() => setExact(false)}>
                    Readable
                  </button>
                  <button type="button" aria-pressed={exact} onClick={() => setExact(true)}>
                    Exact text
                  </button>
                </div>
                <Button variant="secondary" size="sm" onClick={() => onInspect(key)}>
                  Inspect
                </Button>
              </>
            }
          />
          <div className="card-body" style={{ paddingTop: 16 }}>
            {status !== "recorded" && !exact && (
              <p className="helper" style={{ marginBottom: 12 }}>
                This report was not parsed into sections, so its text is shown as submitted.
              </p>
            )}
            <ReportSections parsed={report.parsed} raw={report.raw} mode={exact ? "exact" : "readable"} />
          </div>
        </Card>
        <div className="c4 stack">
          <ClaimsCard
            agentId={report.agentId}
            claims={status === "recorded" ? claimsOf(reportText(report)) : undefined}
            activity={activity.get(report.agentId)}
            loading={side.loading}
            partial={side.partial}
          />
          {bad.length > 0 && (
            <Card>
              <CardHeading title="Invalid submissions" count={bad.length} />
              <div>
                {bad.map((r) => {
                  const st = statusOf(r);
                  return (
                    <div key={r.agentId} className="trow ev-invalid">
                      <div>
                        <RoleChip role={r.agentId} strong />{" "}
                        <Badge tone={st === "empty" ? "neutral" : "danger"}>{STATUS_LABEL[st]}</Badge>
                      </div>
                      <div className="small muted">
                        {st === "empty"
                          ? "No report text was recorded for this role."
                          : st === "unparsed"
                            ? `The text looks like JSON but the parser rejected it (${r.raw.length.toLocaleString()} characters).`
                            : `Submitted ${words(r).toLocaleString()} words of free text the report parser could not read.`}
                      </div>
                      {st !== "empty" && (
                        <button
                          type="button"
                          className="ev-link-btn"
                          style={{ fontSize: 13, justifySelf: "start" }}
                          onClick={() => {
                            setSelectedRole(r.agentId);
                            setExact(true);
                          }}
                        >
                          Read the raw submission
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          <Card>
            <CardHeading title="Report calls" />
            <div className="card-body">
              <dl className="kv" style={{ gridTemplateColumns: "110px minmax(0, 1fr)" }}>
                <dt>Reports</dt>
                <dd>
                  {reports.length}{" "}
                  <span className="muted">· {good} parsed</span>
                </dd>
                {!side.loading && (
                  <>
                    <dt>Submit calls</dt>
                    <dd>
                      {calls}{" "}
                      <span className="muted">
                        {calls > reports.length ? `· ${plural(calls - reports.length, "call")} beyond one per role` : "· one per role"}
                      </span>
                    </dd>
                  </>
                )}
                {reporting && (
                  <>
                    <dt>Schema</dt>
                    <dd>version {reporting.schemaVersion}</dd>
                  </>
                )}
              </dl>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
