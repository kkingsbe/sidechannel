import { Route, Routes, useSearchParams } from "react-router-dom";
import { AnalysisCollection } from "./analysis/analysis-collection";
import { AnalysisDetail } from "./analysis/analysis-detail";
import { AnalysisSetup } from "./analysis/analysis-setup";
import { ConditionComparison } from "./analysis/condition-comparison";

function AnalysisEntry() {
  const [params] = useSearchParams();
  return params.has("run") || params.has("clone") ? (
    <AnalysisSetup />
  ) : (
    <AnalysisCollection />
  );
}

/** Route shell for the analysis workspace; every view owns its own data. */
export default function Analysis() {
  return (
    <Routes>
      <Route index element={<AnalysisEntry />} />
      <Route path="new" element={<AnalysisSetup />} />
      <Route path="compare" element={<ConditionComparison />} />
      <Route path=":id" element={<AnalysisDetail />} />
    </Routes>
  );
}
