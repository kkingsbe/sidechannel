import { useMemo } from "react";
import { ErrorState, Loading, Pager } from "../ui";
import { evidenceKey } from "../../pages/runs/evidence-key";
import { useRunEvidence, useRunId, useRunRoute } from "../../pages/runs/use-run-evidence";
import { useRunRecordOnly } from "../../pages/runs/use-run-record";
import type { BoardPage, ReportPage } from "../../lib/contracts";
import { ArtifactsTab } from "./artifacts-tab";
import { BoardTab } from "./board-tab";
import { isTerminal } from "./evidence-model";
import { MemoryPanel } from "./memory-panel";
import { ReportsTab } from "./reports-tab";
import { useRunEventsByType } from "./use-run-events";

/** Board, artifacts, private memory and reports: one registered run view, one transport slice each. */
export function EvidenceTab({ kind }: { kind: "board" | "artifacts" | "memory" | "reports" }) {
  const id = useRunId();
  const run = useRunRecordOnly(id);
  const evidence = useRunEvidence(kind);
  const { inspect } = useRunRoute();
  const active = !!run.data && !isTerminal(run.data.status);
  const posts = useRunEventsByType(id, ["board_post"], kind === "board" && !!id, active ? 10000 : 0);
  const roles = useMemo(() => run.data?.config.roles.map((role) => role.id) ?? [], [run.data]);
  const postEvents = useMemo(
    () =>
      new Map(
        (posts.events.board_post ?? []).map((event) => [
          String((event.data as { after?: { id?: string } })?.after?.id),
          event,
        ]),
      ),
    [posts.events],
  );
  if (run.loading) return <Loading />;
  if (!run.data) return <ErrorState error={run.error} retry={run.refresh} />;
  const data = run.data;
  if (kind === "memory") return <MemoryPanel runId={id!} active={active} onInspect={inspect} />;
  if (evidence.loading && !evidence.data.length) return <Loading />;
  const board = kind === "board" ? (evidence.payload as BoardPage | undefined) : undefined;
  const reporting =
    kind === "reports" && evidence.payload && "reporting" in evidence.payload
      ? (evidence.payload as ReportPage).reporting
      : undefined;
  const onInspect = (key: string) => inspect(key);
  return (
    <div className="stack">
      {evidence.error && <ErrorState error={evidence.error} retry={evidence.refresh} />}
      {kind === "board" && (
        <BoardTab
          posts={evidence.data}
          postEvents={postEvents}
          deliveries={board?.deliveries}
          roles={roles}
          deliveriesMayHaveMore={board?.deliveriesMayHaveMore}
          eventsPartial={posts.partial}
          keyOf={evidenceKey}
          onInspect={onInspect}
        />
      )}
      {kind === "artifacts" && (
        <ArtifactsTab
          runId={id!}
          run={data}
          versions={evidence.data}
          terminal={isTerminal(data.status)}
          active={active}
          keyOf={evidenceKey}
          onInspect={onInspect}
        />
      )}
      {kind === "reports" && (
        <ReportsTab
          runId={id!}
          reports={evidence.data}
          reporting={reporting}
          active={active}
          keyOf={evidenceKey}
          onInspect={onInspect}
        />
      )}
      {(evidence.page > 0 || evidence.hasMore) && (
        <Pager page={evidence.page} hasMore={evidence.hasMore} onChange={evidence.onChange} />
      )}
    </div>
  );
}
