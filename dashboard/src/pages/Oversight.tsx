import { Link, Route, Routes, useSearchParams } from "react-router-dom";
import { Button, PageHeader } from "../components/ui";
import { ViewPanel } from "../components/view-registry";
import { EvaluationDetail } from "./oversight/evaluation-detail";
import {
  defaultOversightTab,
  OVERSIGHT_TABS,
  OVERSIGHT_VIEWS,
} from "./oversight/views";
import "./runs-oversight.css";

export default function Oversight() {
  return (
    <Routes>
      <Route index element={<OversightSetup />} />
      <Route path="new" element={<OversightSetup creating />} />
      <Route path=":id" element={<EvaluationDetail />} />
    </Routes>
  );
}

function OversightSetup({ creating = false }: { creating?: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") || defaultOversightTab(params, creating);
  return (
    <>
      <PageHeader
        eyebrow="ISOLATED EVIDENCE COMPARISONS"
        title="Oversight monitor"
        description="Compare what the same monitor detects from four explicitly different evidence views."
        actions={
          <Button asChild>
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
