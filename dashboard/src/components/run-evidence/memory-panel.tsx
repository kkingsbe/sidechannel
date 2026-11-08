import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeading, Empty, ErrorState, Loading, Notice } from "../ui";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import { when } from "../../lib/utils";
import {
  memoryUpdates,
  plural,
  rt,
  roundTurn,
  type MemoryUpdate,
} from "./evidence-model";
import { DiffView, diffLines, unitize } from "./line-diff";
import { RoleChip } from "./role-chip";
import { bodyLines, sentenceCase, splitHeaded, splitNumbered } from "./structure";
import { useRunEventsByType } from "./use-run-events";
import "./run-evidence.css";

/** Notes as labelled sections: split on ALL-CAPS headings, numbered plans as ordered lists. */
export function StructuredNotes({ notes }: { notes: string }) {
  const sections = useMemo(() => {
    const segments = splitHeaded(notes);
    return segments.map((segment) => ({
      label: segment.key
        ? sentenceCase(segment.key)
        : /round\s*\d/i.test(segment.body)
          ? "Position"
          : segments.length > 1
            ? "Summary"
            : "Notes",
      body: segment.body,
    }));
  }, [notes]);
  return (
    <dl className="kv ev-memory-kv">
      {sections.map((section, index) => {
        const numbered = splitNumbered(section.body);
        const lines = bodyLines(section.body);
        return (
          <div key={index} style={{ display: "contents" }}>
            <dt>{section.label}</dt>
            <dd>
              {numbered && numbered.length > 1 ? (
                <ol>
                  {numbered.map((point, k) => (
                    <li key={k}>{point}</li>
                  ))}
                </ol>
              ) : lines.bullets ? (
                <ul>
                  {lines.lines.map((line, k) => (
                    <li key={k}>{line}</li>
                  ))}
                </ul>
              ) : (
                lines.lines.map((line, k) => (
                  <p key={k} style={{ margin: k ? "6px 0 0" : 0 }}>
                    {line}
                  </p>
                ))
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ChangedFrom({
  update,
  previous,
}: {
  update: MemoryUpdate;
  previous?: MemoryUpdate;
}) {
  const [full, setFull] = useState(false);
  const lines = useMemo(
    () => diffLines(unitize(update.before), unitize(update.after)),
    [update],
  );
  const removed = lines.filter((line) => line.kind === "removed").length;
  const added = lines.filter((line) => line.kind === "added").length;
  const from = (update.version ?? 1) - 1;
  return (
    <Card>
      <CardHeading
        ruled
        title={`What changed from version ${from}`}
        count={previous ? `${rt(previous.event)} → ${rt(update.event)}` : rt(update.event)}
        description={`Only the lines that changed. Version ${from} ${
          previous ? `was written at ${roundTurn(previous.event).toLowerCase()}` : "is the empty starting note"
        }.`}
        actions={
          <button type="button" className="ev-link-btn" onClick={() => setFull(!full)} aria-expanded={full}>
            {full ? "Show only the changes" : "Show both versions in full"}
          </button>
        }
      />
      <div className="card-body" style={{ paddingTop: 14 }}>
        <DiffView
          before={update.before}
          after={update.after}
          full={full}
          label={`Changes in version ${update.version ?? "?"}`}
        />
      </div>
      <div className="card-foot">
        <span>
          {plural(removed, "line")} removed · {plural(added, "line")} added ·{" "}
          {Math.abs(update.after.length - update.before.length).toLocaleString()} characters net
        </span>
      </div>
    </Card>
  );
}

/** Private working-memory notes, grouped per agent with the changed lines against the previous version. */
export function MemoryPanel({
  runId,
  active,
  onInspect,
}: {
  runId: string;
  active: boolean;
  onInspect: (eventId: string, sequence?: number) => void;
}) {
  const clients = useClients();
  const result = useRunEventsByType(
    runId,
    ["memory_updated"],
    true,
    active ? 10000 : 0,
  );
  const run = useResource(`run:${runId}`, () => clients.runs.get(runId));
  const [selected, setSelected] = useState("");
  const [exact, setExact] = useState(false);
  if (result.loading && !result.events.memory_updated) return <Loading />;
  if (result.error && !result.events.memory_updated)
    return <ErrorState error={result.error} />;
  const grouped = memoryUpdates(result.events.memory_updated ?? []);
  if (!grouped.size)
    return (
      <Empty
        title="No private memory updates recorded"
        description="Unavailable evidence is distinct from an agent that chose not to write notes."
      />
    );
  const configured = run.data?.config.roles.map((role) => role.id) ?? [];
  const agents = [
    ...configured,
    ...[...grouped.keys()].sort().filter((id) => !configured.includes(id)),
  ];
  const agent = agents.includes(selected)
    ? selected
    : (agents.find((id) => grouped.has(id)) ?? agents[0]!);
  const updates = grouped.get(agent) ?? [];
  const changedUpdates = updates.filter((update) => !update.unchanged);
  const latest = [...updates].reverse().find((update) => !update.unchanged) ?? updates.at(-1);
  const total = [...grouped.values()].reduce((sum, list) => sum + list.length, 0);
  const rewriter = [...grouped.entries()]
    .map(([id, list]) => [id, list.filter((update) => !update.unchanged).length] as const)
    .sort((a, b) => b[1] - a[1])[0]!;
  const silent = configured.filter((id) => !grouped.has(id));
  const latestIndex = latest ? updates.indexOf(latest) : -1;
  const previous = latestIndex > 0 ? updates[latestIndex - 1] : undefined;
  const older = latest ? updates.filter((update) => update !== latest).reverse() : [];
  return (
    <div className="stack">
      {result.partial && (
        <Notice kind="warning">
          Only the first recorded memory updates were loaded; later updates are
          not shown.
        </Notice>
      )}
      <p className="finding" style={{ marginTop: 0 }}>
        <strong>
          {rewriter[1] > 0
            ? `${rewriter[0]} rewrote its notes ${rewriter[1] === 1 ? "once" : `${rewriter[1]} times`}${
                silent.length ? `; ${silent.join(" and ")} wrote none` : ""
              }.`
            : `${plural(total, "memory update")} recorded; none changed the notes.`}
        </strong>{" "}
        Private notes are per run and per agent thread; no other agent sees them.
      </p>
      <div className="g12">
        <Card className="c3 ev-role-list">
          <CardHeading title="Roles" count={plural(total, "update")} />
          <div style={{ paddingBottom: 4 }}>
            {agents.map((id) => {
              const list = grouped.get(id);
              const last = list?.at(-1);
              return (
                <button
                  key={id}
                  type="button"
                  className="trow ev-role-btn"
                  aria-current={id === agent}
                  onClick={() => setSelected(id)}
                >
                  <span>
                    <RoleChip role={id} strong />
                    <span className="small muted" style={{ display: "block" }}>
                      {list
                        ? `${plural(list.length, "version")} · last ${rt(last?.event)}`
                        : "no notes written"}
                    </span>
                  </span>
                  <span className="num muted small">
                    {last?.version !== undefined ? "v" + last.version : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
        <div className="c9 stack" id="memory-agent-panel" role="region" aria-label={`Notes of ${agent}`}>
          {!latest ? (
            <Card>
              <CardHeading title={agent} />
              <div className="card-body">
                <p className="helper">
                  {agent} wrote no private notes. Unavailable evidence is distinct from an agent that chose not to
                  write notes.
                </p>
              </div>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeading
                  ruled
                  title={`${agent} · latest notes`}
                  count={`version ${latest.version ?? "?"}`}
                  description={`Written at ${roundTurn(latest.event).toLowerCase()} · ${when(
                    latest.event.timestamp,
                  )} · event #${latest.event.sequence} · ${latest.after.length.toLocaleString()} characters`}
                  actions={
                    <>
                      <div className="seg" role="group" aria-label="View">
                        <button type="button" aria-pressed={!exact} onClick={() => setExact(false)}>
                          Structured
                        </button>
                        <button type="button" aria-pressed={exact} onClick={() => setExact(true)}>
                          Exact text
                        </button>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onInspect(latest.event.id, latest.event.sequence)}
                      >
                        Inspect
                      </Button>
                    </>
                  }
                />
                <div className="card-body" style={{ paddingTop: 16 }}>
                  {!latest.after ? (
                    <p className="helper">The notes are empty.</p>
                  ) : exact ? (
                    <pre className="ev-exact">{latest.after}</pre>
                  ) : (
                    <StructuredNotes notes={latest.after} />
                  )}
                </div>
              </Card>
              {!latest.unchanged && <ChangedFrom update={latest} previous={previous} />}
              {older.length > 0 && (
                <Card>
                  <CardHeading
                    title="Earlier versions"
                    count={`${changedUpdates.length} of ${updates.length} changed the notes`}
                    description="Newest first; each change is shown against the notes it replaced."
                  />
                  <div className="ev-update-list">
                    {older.map((update) => (
                      <details key={update.event.id}>
                        <summary>
                          <strong>
                            Version {update.version ?? "?"} · {rt(update.event)}
                          </strong>
                          <span className="muted">
                            {when(update.event.timestamp)} · event #{update.event.sequence}
                          </span>
                          {update.unchanged && <Badge>Unchanged rewrite</Badge>}
                        </summary>
                        <div className="stack" style={{ marginTop: 10 }}>
                          {update.unchanged ? (
                            <p className="helper">
                              Notes identical to the previous version ({update.after.length} characters).
                            </p>
                          ) : (
                            <DiffView
                              before={update.before}
                              after={update.after}
                              label={`Changes in version ${update.version ?? "?"}`}
                            />
                          )}
                          <div>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => onInspect(update.event.id, update.event.sequence)}
                            >
                              Inspect
                            </Button>
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
