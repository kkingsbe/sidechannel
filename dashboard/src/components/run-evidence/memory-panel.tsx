import { useState } from "react";
import { Badge, Button, Empty, ErrorState, Loading, Notice, Tabs } from "../ui";
import { when } from "../../lib/utils";
import { memoryUpdates, plural, roundTurn } from "./evidence-model";
import { DiffView } from "./line-diff";
import { useRunEventsByType } from "./use-run-events";

/** Private working-memory notes, grouped per agent with a line diff against the previous version. */
export function MemoryPanel({
  runId,
  active,
  onInspect,
}: {
  runId: string;
  active: boolean;
  onInspect: (eventId: string, sequence?: number) => void;
}) {
  const result = useRunEventsByType(
    runId,
    ["memory_updated"],
    true,
    active ? 10000 : 0,
  );
  const [selected, setSelected] = useState("");
  if (result.loading && !result.events.memory_updated) return <Loading />;
  if (result.error && !result.events.memory_updated)
    return <ErrorState error={result.error} />;
  const grouped = memoryUpdates(result.events.memory_updated ?? []);
  const agents = [...grouped.keys()].sort();
  if (!agents.length)
    return (
      <Empty
        title="No private memory updates recorded"
        description="Unavailable evidence is distinct from an agent that chose not to write notes."
      />
    );
  const agent = agents.includes(selected) ? selected : agents[0]!;
  const updates = grouped.get(agent)!;
  const changed = updates.filter((update) => !update.unchanged).length;
  const latest = [...updates].reverse().find((update) => !update.unchanged) ?? updates.at(-1)!;
  return (
    <div className="card-body stack memory-panel">
      {result.partial && (
        <Notice kind="warning">
          Only the first recorded memory updates were loaded; later updates are
          not shown.
        </Notice>
      )}
      <Tabs
        panelId="memory-agent-panel"
        value={agent}
        onChange={setSelected}
        items={agents.map((id) => ({
          id,
          label: id,
          count: grouped.get(id)!.length,
        }))}
      />
      <div id="memory-agent-panel" role="tabpanel" className="stack">
        <p className="helper">
          {plural(updates.length, "update")} by {agent}, {changed} changed the
          notes. Newest first; each change is shown against the notes it
          replaced.
        </p>
        <section className="memory-latest" aria-label={`Latest notes for ${agent}`}>
          <h3>
            Latest notes
            <span className="helper">
              {" "}
              · version {latest.version ?? "?"} · {roundTurn(latest.event)}
            </span>
          </h3>
          {latest.after ? (
            <div className="rv-prose">{latest.after}</div>
          ) : (
            <p className="helper">The notes are empty.</p>
          )}
        </section>
        {[...updates].reverse().map((update) => (
          <article key={update.event.id} className="memory-update">
            <div className="memory-update-heading">
              <strong>
                Version {update.version ?? "?"} · {roundTurn(update.event)}
              </strong>
              <span className="helper">
                {when(update.event.timestamp)} · event #{update.event.sequence}
              </span>
              {update.unchanged && <Badge>Unchanged rewrite</Badge>}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onInspect(update.event.id, update.event.sequence)}
              >
                Inspect
              </Button>
            </div>
            {update.unchanged ? (
              <details>
                <summary className="helper">
                  Notes identical to the previous version ({update.after.length}{" "}
                  characters). Show notes
                </summary>
                <div className="rv-prose">{update.after || "(empty)"}</div>
              </details>
            ) : (
              <>
                <DiffView
                  before={update.before}
                  after={update.after}
                  label={`Changes in version ${update.version ?? "?"}`}
                />
                <details>
                  <summary className="helper">Full notes after this update</summary>
                  <div className="rv-prose">{update.after || "(empty)"}</div>
                </details>
              </>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
