import { createContext, useContext } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ErrorState, Loading } from "../../components/ui";
import type { ViewRegistry } from "../../lib/contracts";
import { CompareAnalyses } from "./compare-analyses";
import { ProvenanceView } from "./provenance-view";
import { ReviewWorkspace } from "./review-workspace";
import { ScorePanel } from "./score-panel";
import { useAnalysisJob } from "./use-analysis-job";

export const ANALYSIS_TABS = [
  "probability",
  "heatmap",
  "table",
  "review",
  "compare",
  "provenance",
] as const;
export type AnalysisTab = (typeof ANALYSIS_TABS)[number];
export const DEFAULT_ANALYSIS_TAB: AnalysisTab = "heatmap";

/** Review queue state shared between the review view and the detail drawer (prop-less views). */
interface AnalysisQueue {
  queue: string[];
  setQueue(ids: string[]): void;
  version: number;
  refresh(): void;
}
const AnalysisQueueContext = createContext<AnalysisQueue>({
  queue: [],
  setQueue: () => {},
  version: 0,
  refresh: () => {},
});
export const AnalysisQueueProvider = AnalysisQueueContext.Provider;
export const useAnalysisQueue = () => useContext(AnalysisQueueContext);

const useRouteId = () => useParams().id!;

function ProbabilityView() {
  return <ScorePanel kind="probability" id={useRouteId()} />;
}
function HeatmapView() {
  return <ScorePanel kind="heatmap" id={useRouteId()} />;
}
function TableView() {
  return <ScorePanel kind="table" id={useRouteId()} />;
}
function ReviewView() {
  const id = useRouteId();
  const job = useAnalysisJob(id);
  const [, setParams] = useSearchParams();
  const queue = useAnalysisQueue();
  if (job.loading) return <Loading />;
  if (!job.job) return <ErrorState error={job.error} retry={job.refresh} />;
  return (
    <ReviewWorkspace
      reviewVersion={queue.version}
      onQueue={queue.setQueue}
      job={job.job}
      onSelect={(window) =>
        setParams((prev) => {
          prev.set("window", window);
          return prev;
        })
      }
    />
  );
}

export const ANALYSIS_VIEWS: ViewRegistry<AnalysisTab> = {
  probability: { title: "Probability timeline", Component: ProbabilityView },
  heatmap: { title: "Heatmap", Component: HeatmapView },
  table: { title: "Score table", Component: TableView },
  review: { title: "Human review", Component: ReviewView },
  compare: { title: "Compare analyses", Component: CompareAnalyses },
  provenance: { title: "Provenance & exports", Component: ProvenanceView },
};
