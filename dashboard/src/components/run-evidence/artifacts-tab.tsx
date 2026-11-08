import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArtifactView } from "../artifact-view";
import { Button, Card, CardHeading, Empty, Select } from "../ui";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { ArtifactVersion, HarnessEvent, Run } from "../../lib/types";
import { plural, rt } from "./evidence-model";
import { RoleChip } from "./role-chip";
import { useRunEventsByType } from "./use-run-events";
import "./run-evidence.css";

interface Entry {
  rank: number;
  case_key: string;
  uncertain: boolean;
  note: string;
}

/** The ranked entries of an artifact value, or undefined when it does not carry the ranking structure. */
export function entriesOf(value: unknown): Entry[] | undefined {
  const entries =
    value && typeof value === "object" && "entries" in value
      ? (value as { entries: unknown }).entries
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
  )
    return undefined;
  return entries as Entry[];
}

/** The total a note states ("... = 20"), when it states one. */
export const scoreOf = (note: string) => {
  const match = /=\s*(\d+)\b/.exec(note);
  return match ? Number(match[1]) : undefined;
};

/** "care_manager 5 + clinical_records 10 + pharmacy 3 = 18" as role/points pairs, only when they add up to the total. */
export function contributionsOf(note: string): [string, number][] | undefined {
  const sum = scoreOf(note);
  const head = note.split("=")[0] ?? "";
  const pairs = [...head.matchAll(/([A-Za-z][A-Za-z_]*)\s+(\d+)/g)].map(
    (m) => [m[1]!, Number(m[2])] as [string, number],
  );
  if (pairs.length < 2 || sum === undefined) return undefined;
  return pairs.reduce((a, [, n]) => a + n, 0) === sum ? pairs : undefined;
}

const timeOf = (value?: string) =>
  value
    ? new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function topLine(entries: Entry[], count = 3) {
  const top = entries.slice(0, count);
  const parts = top.map((entry) => {
    const score = scoreOf(entry.note);
    return `${entry.case_key.replace(/^C-/, "")} ${score ?? "#" + entry.rank}`;
  });
  const uncertain = entries.filter((entry) => entry.uncertain).length;
  return `top ${top.length}: ${parts.join(" · ")} · ${
    !entries.length ? "no entries" : uncertain === entries.length ? "all uncertain" : uncertain ? `${uncertain} uncertain` : "none uncertain"
  }`;
}

function CompareLanes({ run }: { run: Run }) {
  const clients = useClients();
  const pair = useResource<{ runs: Run[] }>(
    run.pairId ? `pair:${run.pairId}` : null,
    () => clients.runs.pair(run.pairId!) as Promise<{ runs: Run[] }>,
  );
  const other = pair.data?.runs.find((candidate) => candidate.id !== run.id);
  const otherRun = useResource<Run>(other ? `run:${other.id}` : null, () => clients.runs.get(other!.id));
  if (!run.pairId || !other) return null;
  const finalOf = (candidate?: Run) => {
    const versions = [...(candidate?.artifacts ?? [])].sort((a, b) => b.version - a.version);
    return versions.map((v) => entriesOf(v.value)).find((e) => e?.length) ?? [];
  };
  const mine = finalOf(run);
  const theirs = otherRun.data ? finalOf(otherRun.data) : undefined;
  const lanes = [
    { condition: run.config.condition.id, entries: mine },
    { condition: other.config.condition.id, entries: theirs },
  ].sort((a, b) => (a.condition === "reviewed" ? -1 : b.condition === "reviewed" ? 1 : 0));
  const keys = (entries?: Entry[]) => entries?.slice(0, 3).map((e) => e.case_key).join(",");
  const same = theirs && keys(mine) === keys(theirs);
  return (
    <Card>
      <CardHeading
        title={`Compare with the ${other.config.condition.id} run`}
        actions={
          <Link className="link" to={"/runs/pairs/" + run.pairId}>
            Pair
          </Link>
        }
      />
      <div className="card-body">
        <div className="lanes" style={{ gap: 10 }}>
          {lanes.map((lane) => (
            <div
              key={lane.condition}
              className={"lane ev-lane" + (lane.condition === "reviewed" ? "" : " excluded")}
            >
              <span className="cond">{lane.condition}</span>
              <span className="small">
                {lane.entries ? (lane.entries.length ? topLine(lane.entries) : "no ranking submitted") : "loading…"}
              </span>
            </div>
          ))}
        </div>
        {theirs && (
          <p className="small muted" style={{ marginTop: 10 }}>
            {same
              ? "Both runs ranked the same top 3 in the same order."
              : "The two runs did not end with the same top 3 in the same order."}
          </p>
        )}
      </div>
    </Card>
  );
}

/** The artifact tab: one ranked table by version, the version list, who touched it and the notes as submitted. */
export function ArtifactsTab({
  runId,
  run,
  versions: rawVersions,
  terminal,
  active,
  keyOf,
  onInspect,
}: {
  runId: string;
  run: Run;
  versions: unknown[];
  terminal: boolean;
  active: boolean;
  keyOf: (item: unknown, index: number) => string;
  onInspect: (key: string) => void;
}) {
  const side = useRunEventsByType(
    runId,
    ["artifact_updated", "tool_requested", "tool_admitted"],
    true,
    active ? 10000 : 0,
  );
  const versions = useMemo(
    () => [...(rawVersions as ArtifactVersion[])].sort((a, b) => a.version - b.version),
    [rawVersions],
  );
  const keys = new Map(rawVersions.map((item, index) => [(item as ArtifactVersion).version, keyOf(item, index)]));
  const versionEvents = new Map<number, HarnessEvent>(
    (side.events.artifact_updated ?? []).map((event) => [
      Number((event.data as { after?: { version?: number } })?.after?.version),
      event,
    ]),
  );
  const parsed = versions.map((v) => ({ v, entries: entriesOf(v.value) }));
  const ranked = parsed.length > 0 && parsed.every((p) => p.entries !== undefined);
  const withEntries = parsed.filter((p) => p.entries?.length);
  const lastAuthored = [...parsed].reverse().find((p) => p.v.authorId && p.entries?.length);
  const [chosen, setChosen] = useState<number>();
  const shown = parsed.find((p) => p.v.version === chosen) ?? lastAuthored ?? withEntries.at(-1) ?? parsed.at(-1);
  const roles = run.config.roles.map((role) => role.id);

  if (!versions.length)
    return terminal ? (
      <Empty
        title="No artifact recorded on this page"
        description="Unavailable evidence is distinct from an empty agent action or a negative finding."
      />
    ) : (
      <Empty
        title="No submission yet"
        description="The run is still in progress; artifact versions appear as agents submit them."
      />
    );

  const finalPart = parsed.at(-1)!;
  const frozen = finalPart.v.frozen ? finalPart.v : undefined;
  const authors = new Map<string, number>();
  for (const { v } of parsed) if (v.authorId) authors.set(v.authorId, (authors.get(v.authorId) ?? 0) + 1);
  const count = (list: HarnessEvent[] | undefined, name: string, role?: string) =>
    (list ?? []).filter((event) => {
      const call = (event.data as { call?: { name?: string } })?.call;
      return call?.name === name && (role === undefined || event.agentId === role);
    }).length;
  const reads = count(side.events.tool_admitted, "read_artifact");
  const failed = roles.reduce((total, role) => {
    const asked = count(side.events.tool_requested, "update_artifact", role);
    const done = (side.events.artifact_updated ?? []).filter((event) => event.agentId === role).length;
    return total + Math.max(asked - done, 0);
  }, 0);
  const readers = new Set(
    (side.events.tool_admitted ?? [])
      .filter((event) => (event.data as { call?: { name?: string } })?.call?.name === "read_artifact")
      .map((event) => event.agentId),
  );
  const neverUpdated = roles.filter((role) => !authors.has(role));

  // Finding.
  let strong: string;
  let rest = "";
  if (!withEntries.length) {
    strong = terminal ? "No ranking was ever submitted to the shared artifact." : "No ranking has been submitted yet.";
  } else {
    const nonEmpty = withEntries.map((p) => p.entries!);
    const orderKey = (entries: Entry[]) => entries.map((e) => e.case_key).join(",");
    const orderChanges = nonEmpty.slice(1).filter((e, i) => orderKey(e) !== orderKey(nonEmpty[i]!)).length;
    const updates = [...authors.values()].reduce((a, b) => a + b, 0);
    const k = Math.max(...nonEmpty.map((e) => e.length));
    const last = nonEmpty.at(-1)!;
    const uncertain = last.filter((e) => e.uncertain).length;
    strong = `${plural(updates, "agent update")} built the ranking${
      orderChanges ? `, and the order of the top ${k} changed ${orderChanges === 1 ? "once" : orderChanges + " times"}` : `, and the order of the top ${k} never changed`
    }.`;
    rest = ` ${frozen ? `Version ${frozen.version} froze the final ranking at the end of the run` : "The artifact is not frozen yet"}; ${
      uncertain === last.length ? "every entry is marked uncertain" : uncertain ? `${uncertain} of ${last.length} entries are marked uncertain` : "no entry is marked uncertain"
    }.`;
  }

  const rankedTable = (() => {
    if (!ranked || !withEntries.length) return undefined;
    const finalEntries = withEntries.at(-1)!.entries!;
    const keysOrdered = [
      ...finalEntries.map((e) => e.case_key),
      ...withEntries.flatMap((p) => p.entries!.map((e) => e.case_key)),
    ].filter((key, i, all) => all.indexOf(key) === i);
    const cell = (entries: Entry[] | undefined, key: string) => {
      const entry = entries?.find((e) => e.case_key === key);
      if (!entry) return undefined;
      return scoreOf(entry.note) ?? "#" + entry.rank;
    };
    return { keysOrdered, finalEntries, cell };
  })();

  return (
    <div className="stack">
      <p className="finding" style={{ marginTop: 0 }}>
        <strong>{strong}</strong>
        {rest}
      </p>
      <div className="g12">
        <div className="c8 stack">
          {rankedTable ? (
            <Card>
              <CardHeading
                ruled
                title="Shared ranked artifact"
                count={`top ${Math.max(...withEntries.map((p) => p.entries!.length))}, by version`}
                description="Scores are the totals each version's notes state. A dash means the case was not ranked in that version; changed cells are outlined."
                actions={frozen ? <span className="badge">frozen at version {frozen.version}</span> : undefined}
              />
              <div className="table-scroll">
                <table className="ev-grid-table" aria-label="Ranked cases by artifact version">
                  <thead>
                    <tr>
                      <th style={{ width: 52 }}>Rank</th>
                      <th>Case key</th>
                      {parsed.map((p, index) => {
                        const isFinal = index === parsed.length - 1;
                        const event = versionEvents.get(p.v.version);
                        const who = p.v.frozen ? "frozen" : (p.v.authorId ?? "initialized");
                        return (
                          <th key={p.v.version} className={"n ev-ver" + (isFinal ? " ev-final" : "")}>
                            {`Version ${p.v.version}${isFinal ? " · final" : ""}`}
                            <span>{p.v.frozen ? "frozen · end of run" : `${who}${event ? " · " + rt(event).replace(/ · /g, " ") : ""}`}</span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rankedTable.keysOrdered.map((key) => {
                      const finalEntry = rankedTable.finalEntries.find((e) => e.case_key === key);
                      const contributions = finalEntry ? contributionsOf(finalEntry.note) : undefined;
                      let lastSeen: string | number | undefined;
                      return (
                        <tr key={key}>
                          <td className={"n" + (finalEntry ? "" : " muted")} style={{ textAlign: "left" }}>
                            {finalEntry?.rank ?? "—"}
                          </td>
                          <td>
                            <span className="mono">{key}</span>
                            {contributions && (
                              <span className="ev-sub">
                                {contributions.map(([role, n]) => `${role} ${n}`).join(" · ")}
                              </span>
                            )}
                          </td>
                          {parsed.map((p, index) => {
                            const value = rankedTable.cell(p.entries, key);
                            const isFinal = index === parsed.length - 1;
                            const changed = value !== undefined && lastSeen !== undefined && value !== lastSeen;
                            if (value !== undefined) lastSeen = value;
                            return (
                              <td key={p.v.version} className={"n" + (isFinal ? " ev-final-col" : "")}>
                                {value === undefined ? (
                                  <span className="faint">—</span>
                                ) : (
                                  <span className={"ev-cell" + (changed ? " ev-cell-changed" : "")}>{value}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="card-foot">
                <span>
                  {(() => {
                    const last = rankedTable.finalEntries;
                    const u = last.filter((e) => e.uncertain).length;
                    return `${u === last.length ? "Every" : u ? `${u} of ${last.length}` : "No"} final ${u === last.length ? "entry is" : "entries are"} marked uncertain. Outlined cells changed from the previous version that ranked the case.`;
                  })()}
                </span>
              </div>
            </Card>
          ) : (
            parsed.map(({ v }, index) => (
              <Card key={v.version}>
                <CardHeading
                  ruled
                  title={v.frozen ? `Final frozen version ${v.version}` : `Version ${v.version}`}
                  description={v.authorId ?? "system"}
                  actions={
                    <Button variant="secondary" size="sm" onClick={() => onInspect(keys.get(v.version) ?? String(index))}>
                      Inspect
                    </Button>
                  }
                />
                <div className="card-body" style={{ paddingTop: 14 }}>
                  <ArtifactView
                    value={v.value}
                    schemaVersion={run.config.artifactSchemaVersion}
                    scenarioVersion={run.config.scenario.version}
                    terminal={terminal}
                  />
                </div>
              </Card>
            ))
          )}
          {rankedTable && shown && (
            <Card>
              <CardHeading
                ruled
                title={`Version ${shown.v.version}`}
                count="notes as submitted"
                description={`${shown.v.frozen ? "system, frozen" : (shown.v.authorId ?? "system")}${
                  versionEvents.get(shown.v.version)
                    ? ` · ${rt(versionEvents.get(shown.v.version))} · event #${versionEvents.get(shown.v.version)!.sequence}`
                    : ""
                } · the text written beside each ranked entry`}
                actions={
                  <>
                    <Select
                      aria-label="Version shown"
                      value={String(shown.v.version)}
                      onChange={(e) => setChosen(Number(e.target.value))}
                    >
                      {parsed.map((p) => (
                        <option key={p.v.version} value={p.v.version}>
                          Version {p.v.version}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onInspect(keys.get(shown.v.version) ?? "version-" + shown.v.version)}
                    >
                      Inspect
                    </Button>
                  </>
                }
              />
              <ArtifactView
                value={shown.v.value}
                schemaVersion={run.config.artifactSchemaVersion}
                scenarioVersion={run.config.scenario.version}
                terminal={terminal}
              />
            </Card>
          )}
        </div>
        <div className="c4 stack">
          <Card className="ev-versions">
            <CardHeading title="Versions" count={`${parsed.length}, one per update`} />
            <div style={{ paddingBottom: 4 }}>
              {[...parsed].reverse().map((p, position) => {
                const { v, entries } = p;
                const event = versionEvents.get(v.version);
                const before = parsed.find((q) => q.v.version === v.previousVersion);
                const identical = v.frozen && before && sameValue(before.v.value, v.value);
                const note =
                  v.version === 0
                    ? "Initialized empty"
                    : v.frozen
                      ? identical
                        ? `Frozen at the end of the run, identical to version ${before!.v.version}`
                        : "Frozen at the end of the run"
                      : entries
                        ? `Ranked ${plural(entries.length, "case")}${
                            entries.filter((e) => e.uncertain).length
                              ? `, ${entries.filter((e) => e.uncertain).length} marked uncertain`
                              : ""
                          }`
                        : "Updated";
                return (
                  <div key={v.version} className="trow">
                    <span className={"ev-pill" + (position === 0 && v.frozen ? " ev-pill-final" : "")}>{v.version}</span>
                    <div style={{ minWidth: 0 }}>
                      <div>
                        <RoleChip role={v.authorId ?? "system"} />
                        {event && <span className="muted"> · {rt(event)}</span>}
                        {v.frozen && <span className="muted"> · final</span>}
                      </div>
                      <div className="small muted">{note}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="small muted">{timeOf(event?.timestamp)}</div>
                      <button
                        type="button"
                        className="ev-link-btn"
                        style={{ fontSize: 12 }}
                        onClick={() => onInspect(keys.get(v.version) ?? "version-" + v.version)}
                      >
                        Inspect
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card>
            <CardHeading title="Who touched the artifact" />
            <div className="card-body">
              <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
                <dt>Updates</dt>
                <dd>
                  {[...authors.values()].reduce((a, b) => a + b, 0)}{" "}
                  <span className="muted">
                    {authors.size ? "· " + [...authors].map(([role, n]) => `${role} ${n}`).join(", ") : ""}
                  </span>
                </dd>
                {!side.loading && (
                  <>
                    <dt>Failed updates</dt>
                    <dd>
                      {failed}{" "}
                      <span className="muted">{failed ? "· requested but never recorded" : ""}</span>
                    </dd>
                    <dt>Reads</dt>
                    <dd>
                      {reads}{" "}
                      <span className="muted">
                        · {readers.size === roles.length ? "every role at least once" : `${plural(readers.size, "role")}`}
                      </span>
                    </dd>
                  </>
                )}
                <dt>Never updated by</dt>
                <dd>
                  {neverUpdated.length ? (
                    <span style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
                      {neverUpdated.map((role) => (
                        <RoleChip key={role} role={role} />
                      ))}
                    </span>
                  ) : (
                    <span className="muted">every role updated it</span>
                  )}
                </dd>
              </dl>
            </div>
          </Card>
          <CompareLanes run={run} />
        </div>
      </div>
    </div>
  );
}
