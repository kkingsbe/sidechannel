import { Link, Route, Routes, useSearchParams } from "react-router-dom";
import { Button, PageHeader } from "../components/ui";
import { ViewPanel } from "../components/view-registry";
import { useClients } from "../lib/clients/context";
import { useResource } from "../lib/clients/query";
import { EvaluationDetail } from "./oversight/evaluation-detail";
import {
  defaultOversightTab,
  OVERSIGHT_TABS,
  OVERSIGHT_VIEWS,
} from "./oversight/views";
import "./oversight.css";
import "./oversight/oversight.css";

export default function Oversight() {
  return (
    <Routes>
      <Route index element={<OversightSetup />} />
      <Route path="new" element={<OversightSetup creating />} />
      <Route path=":id" element={<EvaluationDetail />} />
    </Routes>
  );
}

/** The finding: how many evaluations exist and how many completed runs could be evaluated. */
function useOversightFinding() {
  const clients = useClients();
  const evaluations = useResource("oversight:finding-evaluations", () => clients.monitor.evaluations({ limit: 25 }));
  const eligible = useResource("oversight:finding-eligible", () =>
    clients.runs.list({ summary: true, status: "completed", limit: 1 }),
  );
  const count = eligible.data ? (eligible.data.total ?? eligible.data.items.length) : undefined;
  const items = evaluations.data?.items;
  const runs = count === undefined ? undefined : `${count} completed ${count === 1 ? "run is" : "runs are"} eligible.`;
  if (!items) return <>Four evidence views, one frozen monitor: compare what each view lets the monitor detect.</>;
  if (!items.length)
    return (
      <>
        <strong>No monitor evaluations yet{runs ? "; " + runs : "."}</strong> Each evaluation sends the same frozen questions to one monitor model under four evidence views.
      </>
    );
  const active = items.filter((job) => job.status === "queued" || job.status === "running").length;
  const total = items.length + (evaluations.data?.nextCursor ? "+" : "");
  return (
    <>
      <strong>{total} monitor {items.length === 1 ? "evaluation" : "evaluations"}{active ? `, ${active} running` : ""}.</strong>{" "}
      {runs ?? ""}
    </>
  );
}

function OversightSetup({ creating = false }: { creating?: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") || defaultOversightTab(params, creating);
  const finding = useOversightFinding();
  return (
    <>
      <PageHeader
        title="Oversight"
        description={finding}
        actions={
          <Button asChild variant="secondary">
            <Link to="/oversight/new">New evaluation</Link>
          </Button>
        }
      />
      <ViewPanel
        registry={OVERSIGHT_VIEWS}
        order={OVERSIGHT_TABS}
        tab={tab}
        panelId="oversight-view-panel"
        onChange={(view) =>
          setParams((prev) => {
            prev.set("view", view);
            return prev;
          })
        }
      />
    </>
  );
}
