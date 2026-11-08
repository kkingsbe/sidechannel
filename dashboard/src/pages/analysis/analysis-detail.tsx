import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Copy, Download, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  ConditionPill,
  Drawer,
  ErrorState,
  JsonView,
  Loading,
  Notice,
} from "../../components/ui";
import { ViewPanel } from "../../components/view-registry";
import { CancelJobButton } from "../../components/cancel-job-button";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { ReviewBatch } from "../../lib/analysis-types";
import { jobStatusMeta } from "../../lib/status";
import { short, when } from "../../lib/utils";
import { WindowInspector } from "./window-inspector";
import { useAnalysisJob } from "./use-analysis-job";
import { ScoreFiltersProvider, useAnalysisWindows } from "./use-analysis-windows";
import { WindowStrip } from "./window-strip";
import { analysisFinding } from "./analysis-summary";
import {
  ANALYSIS_TABS,
  AnalysisQueueProvider,
  DEFAULT_ANALYSIS_TAB,
  ANALYSIS_VIEWS,
  type AnalysisTab,
} from "./views";
import "./analysis.css";

/** The analysis detail: object header, finding and coverage strip, registry dispatch and the window drawer. */
export function AnalysisDetail() {
  return (
    <ScoreFiltersProvider>
      <AnalysisDetailBody />
    </ScoreFiltersProvider>
  );
}

function AnalysisDetailBody() {
  const { id } = useParams();
  const clients = useClients();
  const [params, setParams] = useSearchParams();
  const job = useAnalysisJob(id);
  const windows = useAnalysisWindows(id);
  const [queue, setQueue] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const batchId = params.get("batch");
  const persistedBatch = useResource<{ batch: ReviewBatch }>(
    batchId ? `analysis:${id}:batch:${batchId}` : null,
    () => clients.analyses.batch(id!, batchId!, { limit: 1 }),
  );
  if (job.loading) return <Loading />;
  if (!job.job) return <ErrorState error={job.error} retry={job.refresh} />;
  const data = job.job;
  const tab = (params.get("view") || DEFAULT_ANALYSIS_TAB) as AnalysisTab;
  const isReviewTab = tab === "review";
  const windowId = windows.windowId;
  const setTab = (view: AnalysisTab) =>
    setParams((prev) => {
      prev.set("view", view);
      return prev;
    });
  const codes = data.manifest.codebook.codes.filter((c) => c.enabled && !c.archived);
  const finding = analysisFinding(windows.windows, codes, windows.threshold);
  const settings = data.manifest.settings;
  const source = job.sourceRun;
  return (
    <>
      <Link
        className="crumb-back"
        to={
          params.get("return")?.startsWith("/analysis?")
            ? params.get("return")!
            : "/analysis"
        }
      >
        <ArrowLeft size={14} />
        All analyses
      </Link>
      <header className="objhead">
        <div className="glyph" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 22 22">
            <rect x="2" y="12" width="3.5" height="8" fill="var(--blue)" />
            <rect x="7" y="6" width="3.5" height="14" fill="var(--blue)" />
            <rect x="12" y="2" width="3.5" height="18" fill="var(--blue)" />
            <rect x="17" y="9" width="3.5" height="11" fill="var(--blue)" />
          </svg>
        </div>
        <div className="an-headtext">
          <div className="titleline">
            <h1>{source?.config?.label || "Trace analysis"}</h1>
            <ConditionPill condition={source?.config?.condition?.id} />
            <Badge tone={jobStatusMeta[data.status].tone}>{jobStatusMeta[data.status].label}</Badge>
          </div>
          <div className="meta">
            <span>
              {settings.model} · {settings.windowSize}-step windows, stride {settings.stride} · codebook revision{" "}
              {data.manifest.codebook.revision}
            </span>
            <span>·</span>
            <span>
              source run{" "}
              <Link className="link mono" to={"/runs/" + data.runId} title="Open source run">
                {short(data.runId)}
              </Link>{" "}
              up to event {data.manifest.sequenceBoundary}
            </span>
            <span>·</span>
            <button
              type="button"
              className="an-plain mono"
              title="Copy full analysis ID"
              aria-label="Copy full analysis ID"
              onClick={() => navigator.clipboard.writeText(data.id)}
            >
              {short(data.id)}
            </button>
            <span>·</span>
            <span>{when(data.createdAt)}</span>
          </div>
        </div>
        <div className="actions">
          <Button asChild variant="secondary">
            <Link to={"/analysis?run=" + data.runId + "&clone=" + data.id}>
              <Copy size={14} />
              Duplicate settings
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <a href={clients.analyses.exportUrl(id!)} download>
              <Download size={14} />
              Export analysis
            </a>
          </Button>
          <CancelJobButton
            active={job.active}
            cancelRequested={data.cancelRequested}
            busy={job.command.busy}
            confirm="Cancel remaining analysis work? Successful scores and their evidence remain saved."
            idleLabel="Cancel"
            requestedLabel="Cancellation requested"
            onCancel={job.cancel}
          />
          {jobStatusMeta[data.status].retryOffered && (
            <Button
              variant="secondary"
              disabled={job.command.busy}
              onClick={() => void job.retry()}
            >
              <RefreshCw size={14} />
              Retry missing
            </Button>
          )}
        </div>
      </header>
      {(job.error || windows.error) && (
        <Notice kind="warning">
          Connection stale: {(job.error || windows.error)?.message}. Saved
          results stay available.
        </Notice>
      )}
      {data.error && (
        <>
          <Notice kind="error">The analysis reported an error; completed scores remain saved.</Notice>
          <JsonView value={data.error} title="Full diagnostic" />
        </>
      )}
      {job.command.error && (
        <Notice kind="error">{job.command.error.message}</Notice>
      )}
      {job.command.message && (
        <Notice kind="success">{job.command.message}</Notice>
      )}
      <div className="g12 an-summary">
        <p className="finding c8">
          <strong>{finding.lead}</strong> {finding.rest}
        </p>
        <div className="c4">
          <WindowStrip windows={windows.windows} codes={codes} threshold={windows.threshold} />
        </div>
      </div>
      <AnalysisQueueProvider
        value={{ queue, setQueue, version, refresh: () => setVersion((v) => v + 1) }}
      >
        <ViewPanel
          registry={ANALYSIS_VIEWS}
          order={ANALYSIS_TABS}
          tab={tab}
          panelId="analysis-view-panel"
          onChange={setTab}
        />
      </AnalysisQueueProvider>
      <Drawer
        wide
        open={!!windowId}
        onOpenChange={(open) => {
          if (!open) windows.close();
        }}
        title={
          windows.detail
            ? `Window ${windows.detail.window.index + 1} · steps ${windows.detail.window.startStep}–${windows.detail.window.endStep}`
            : "Analysis window"
        }
        description="Exact normalized evidence and canonical source links."
      >
        {windows.detailLoading ? (
          <Loading />
        ) : windows.detailError ? (
          <ErrorState error={windows.detailError} retry={windows.refreshDetail} />
        ) : (
          windows.detail && (
            <WindowInspector
              key={windows.detail.window.id}
              detail={windows.detail}
              job={data}
              onSaved={() => setVersion((v) => v + 1)}
              onNext={
                isReviewTab && queue.includes(windowId!)
                  ? () =>
                      setParams((prev) => {
                        const next = queue[queue.indexOf(windowId!) + 1];
                        if (next) prev.set("window", next);
                        else prev.delete("window");
                        return prev;
                      })
                  : undefined
              }
              onReturn={windows.close}
              blind={
                isReviewTab &&
                (batchId
                  ? persistedBatch.data?.batch.id !== batchId ||
                    persistedBatch.data?.batch.mode === "blind"
                  : params.get("blind") === "true")
              }
            />
          )
        )}
      </Drawer>
    </>
  );
}
