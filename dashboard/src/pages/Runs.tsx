import { Route, Routes } from "react-router-dom";
import { RunList } from "./runs/run-list";
import { RunDetail } from "./runs/run-detail";
import { PairDetail } from "./runs/pair-detail";
import "./runs/runs.css";

/** Route shell: every view owns its own data and markup. */
export default function Runs() {
  return (
    <Routes>
      <Route index element={<RunList />} />
      <Route path=":id" element={<RunDetail />} />
      <Route path="pairs/:id" element={<PairDetail />} />
    </Routes>
  );
}
