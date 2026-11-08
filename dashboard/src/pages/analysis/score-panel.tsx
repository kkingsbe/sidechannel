import { useState } from "react";
import { Card, CardHeading, Empty, ErrorState, Loading } from "../../components/ui";
import type { AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";
import { useAnalysisJob } from "./use-analysis-job";
import { useAnalysisWindows } from "./use-analysis-windows";
import { HeatmapTable } from "./heatmap-table";
import { ProbabilityPlot } from "./probability-plot";
import { ScoreTable } from "./score-table";
import { BehaviourFilter, ThresholdInput } from "./score-controls";
import { coverage, flaggedCounts, highWindows, stepLabel } from "./analysis-summary";
import { percent, sortWindows } from "./analysis-view";

const FOOT =
  "Estimated probability the behavior occurs in this window. Exploratory estimates, not calibrated accuracy or run-level labels; missing results are gaps, never zero.";

function Foot({ windows }: { windows: AnalysisWindow[] }) {
  const cov = coverage(windows);
  return (
    <div className="card-foot">
      <span>{FOOT}</span>
      <span className="nowrap">
        {cov.total} windows · {windows.filter((w) => w.partial).length} partial
      </span>
    </div>
  );
}

/**
 * The probability/heatmap/table views. One data owner for the window list and the
 * display-only filters; `kind` selects the render branch.
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
  const [picked, setPicked] = useState<string>();
  if (job.loading) return <Loading />;
  if (!job.job) return <ErrorState error={job.error} retry={job.refresh} />;
  const codes = job.job.manifest.codebook.codes.filter((c) => c.enabled && !c.archived);
  const shown = codes.filter((c) => !state.visible || state.visible.includes(c.id));
  const current = sortWindows(state.windows);
  const open = (window: AnalysisWindow, code?: BehaviorCode) => state.open(window.id, code?.id);
  const waiting = state.loading ? (
    <Loading />
  ) : !current.length ? (
    <Empty
      title="Windows are being prepared"
      description="The worker persists progress; this page can be closed safely."
    />
  ) : null;
  const controls = (
    <>
      <ThresholdInput threshold={state.threshold} onChange={state.setThreshold} />
      <BehaviourFilter codes={codes} visible={state.visible} onChange={state.setVisible} />
    </>
  );

  if (kind === "heatmap")
    return (
      <Card className="an-card">
        <CardHeading
          ruled
          title="Probability by behavior and source step"
          description={`Each cell is one ${job.job.manifest.settings.windowSize}-step window; darker is more likely. Cells at or above the threshold are outlined.`}
          actions={controls}
        />
        {waiting ?? (
          <div className="card-body an-body">
            {shown.length ? (
              <HeatmapTable
                windows={current}
                codes={shown}
                threshold={state.threshold}
                onSelect={open}
              />
            ) : (
              <Empty title="No behaviors selected" description="Choose at least one behavior in the filter." />
            )}
          </div>
        )}
        <Foot windows={current} />
      </Card>
    );

  if (kind === "table")
    return (
      <Card className="an-card">
        <CardHeading
          ruled
          title="Scores by window"
          description="Whole-percent estimates per source window; outlined values are at or above the threshold."
          actions={controls}
        />
        {waiting ?? <ScoreTable windows={current} codes={shown} threshold={state.threshold} onSelect={open} />}
        <Foot windows={current} />
      </Card>
    );

  return (
    <ProbabilityView
      codes={codes}
      windows={current}
      threshold={state.threshold}
      picked={picked}
      onPick={setPicked}
      waiting={waiting}
      onSelect={open}
      controls={<ThresholdInput threshold={state.threshold} onChange={state.setThreshold} />}
    />
  );
}

function ProbabilityView({
  codes,
  windows,
  threshold,
  picked,
  onPick,
  waiting,
  onSelect,
  controls,
}: {
  codes: BehaviorCode[];
  windows: AnalysisWindow[];
  threshold: number;
  picked: string | undefined;
  onPick: (id: string) => void;
  waiting: React.ReactNode;
  onSelect: (w: AnalysisWindow) => void;
  controls: React.ReactNode;
}) {
  const code =
    codes.find((c) => c.id === picked) ?? flaggedCounts(windows, codes, threshold)[0]?.code ?? codes[0];
  if (!code) return <Empty title="No behaviors in this codebook revision" />;
  const high = highWindows(windows, codes, code, threshold);
  const thr = Math.round(threshold * 100);
  return (
    <div className="g12 an-equal">
      <Card className="c8 an-card">
        <CardHeading
          ruled
          title={`${code.code} over the run`}
          description={code.definition || undefined}
          actions={
            <>
              {controls}
              <label className="cf">
                <span>Behavior</span>
                <select value={code.id} onChange={(e) => onPick(e.target.value)} aria-label="Behavior to plot">
                  {codes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </label>
            </>
          }
        />
        {waiting ?? (
          <div className="card-body an-body">
            <ProbabilityPlot code={code} windows={windows} threshold={threshold} onSelect={onSelect} />
          </div>
        )}
        <div className="card-foot">
          <span>{FOOT} Points sit at window ends; lines break at unscored windows.</span>
        </div>
      </Card>
      <Card className="c4 an-card">
        <CardHeading title={`Windows at or above ${thr}%`} count={`${Math.min(8, high.length)} of ${high.length}`} />
        {high.length ? (
          <div>
            {high.slice(0, 8).map(({ window, value, others }) => (
              <button
                type="button"
                key={window.id}
                className="trow an-rank"
                onClick={() => onSelect(window)}
              >
                <span className="mono small muted">{stepLabel(window)}</span>
                <span>
                  {code.code}
                  {others.length > 0 && (
                    <span className="muted">
                      {" · "}
                      {others
                        .slice(0, 3)
                        .map((o) => `${o.code.code} ${percent(o.value)}`)
                        .join(", ")}
                    </span>
                  )}
                </span>
                <span className="n an-strong">{percent(value)}%</span>
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title={`No ${code.code} window reaches ${thr}%`}
            description="Lower the highlight threshold or pick another behavior."
          />
        )}
      </Card>
    </div>
  );
}
