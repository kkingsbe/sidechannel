import {
  Card,
  Check,
  Empty,
  ErrorState,
  Field,
  Input,
  Loading,
  Notice,
  Pager,
} from "../../components/ui";
import { useAnalysisJob } from "./use-analysis-job";
import { useAnalysisWindows } from "./use-analysis-windows";
import { HeatmapTable } from "./heatmap-table";
import { ProbabilityPlot } from "./probability-plot";
import { ScoreTable } from "./score-table";
import { plural, sortWindows } from "./analysis-view";

/**
 * The probability/heatmap/table views. One data owner for the window page, the coverage
 * notice and the display-only filter; `kind` selects the render branch.
 */
export function ScorePanel({
  kind,
  id,
}: {
  kind: "probability" | "heatmap" | "table";
  id: string;
}) {
  const job = useAnalysisJob(id);
  const state = useAnalysisWindows(id);
  if (job.loading) return <Loading />;
  if (!job.job) return <ErrorState error={job.error} retry={job.refresh} />;
  const codes = job.job.manifest.codebook.codes.filter(
    (c) => c.enabled && !c.archived,
  );
  const shown = codes.filter((c) => !state.visible || state.visible.includes(c.id));
  const current = sortWindows(state.windows);
  return (
    <>
      <Notice>
        Coverage on this page: {plural(current.length, "window")} -{" "}
        {plural(current.filter((w) => w.partial).length, "partial window", "partial windows")} -{" "}
        {current.filter((w) => !w.results?.length).length} without scores.
        Estimated probability the behavior occurs in this window. Values are
        exploratory estimates, not calibrated accuracy or run-level reference
        labels. Missing results are gaps, never zero.
      </Notice>
      <Card>
        <div className="filter-bar">
          <Field label="Highlight threshold (display only)">
            <Input
              type="number"
              min="0"
              max="1"
              step=".05"
              value={state.threshold}
              onChange={(e) => state.setThreshold(e.target.valueAsNumber)}
            />
          </Field>
          <div className="actions" style={{ flex: 1 }}>
            {codes.map((code) => (
              <Check
                key={code.id}
                label={code.code}
                checked={!state.visible || state.visible.includes(code.id)}
                onChange={(e) =>
                  state.setVisible(
                    e.target.checked
                      ? [...(state.visible ?? codes.map((c) => c.id)), code.id]
                      : (state.visible ?? codes.map((c) => c.id)).filter(
                          (id) => id !== code.id,
                        ),
                  )
                }
              />
            ))}
          </div>
        </div>
        {state.loading ? (
          <Loading />
        ) : !current.length ? (
          <Empty
            title="Windows are being prepared"
            description="The worker persists progress; this page can be closed safely."
          />
        ) : kind === "probability" ? (
          <div className="card-body" style={{ paddingTop: 20 }}>
            <p className="helper" style={{ marginBottom: 14 }}>
              Points sit at window ends. Segments connect overlapping-window
              estimates; they do not measure an instantaneous signal.
            </p>
            {shown.map((code) => (
              <ProbabilityPlot
                key={code.id}
                code={code}
                windows={current}
                onSelect={(window) => state.open(window.id)}
              />
            ))}
          </div>
        ) : kind === "heatmap" ? (
          <HeatmapTable
            windows={current}
            codes={shown}
            threshold={state.threshold}
            onSelect={(window) => state.open(window.id)}
          />
        ) : (
          <ScoreTable
            windows={current}
            codes={shown}
            onSelect={(window) => state.open(window.id)}
          />
        )}
        <Pager
          page={state.page}
          hasMore={state.hasMore}
          onChange={state.onChange}
        />
      </Card>
    </>
  );
}
