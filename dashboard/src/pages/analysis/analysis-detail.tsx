import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Copy, Download, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Drawer,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
} from "../../components/ui";
import { ViewPanel } from "../../components/view-registry";
import { CancelJobButton } from "../../components/cancel-job-button";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { ReviewBatch } from "../../lib/analysis-types";
import { jobStatusMeta } from "../../lib/status";
import { WindowInspector } from "./window-inspector";
import { useAnalysisJob } from "./use-analysis-job";
import { useAnalysisWindows } from "./use-analysis-windows";
import {
  ANALYSIS_TABS,
  ANALYSIS_VIEWS,
  AnalysisQueueProvider,
  DEFAULT_ANALYSIS_TAB,
  type AnalysisTab,
} from "./views";

/** The analysis detail: frozen header, registry dispatch and the window drawer. */
export function AnalysisDetail() {
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
  const isReviewTab = ANALYSIS_VIEWS[tab]?.title === "Human review";
  const windowId = windows.windowId;
  const setTab = (view: AnalysisTab) =>
    setParams((prev) => {
      prev.set("view", view);
      return prev;
    });
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link
          to={
            params.get("return")?.startsWith("/analysis?")
              ? params.get("return")!
              : "/analysis"
          }
        >
          <ArrowLeft size={14} />
          All analyses
        </Link>
      </Button>
      <PageHeader
        eyebrow="JEV ANALYSIS"
        title={`${job.sourceRun?.config?.label || "Trace analysis"} - ${job.sourceRun?.config?.condition?.id || "Condition unavailable"} - ${data.manifest.settings.model} - ${data.manifest.settings.windowSize}-step windows`}
        description={`Source run ${data.runId} · ${data.manifest.settings.model}`}
        actions={
          <>
            <Badge tone={jobStatusMeta[data.status].tone}>{jobStatusMeta[data.status].label}</Badge>
            <Button asChild variant="secondary">
              <Link to={"/analysis?run=" + data.runId + "&clone=" + data.id}>
                <Copy size={14} />
                Duplicate settings
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <a href={clients.analyses.exportUrl(id!)} download>
                <Download size={14} />
                Full analysis export
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
          </>
        }
      />
      <div className="run-metadata">
        <Link className="table-title" to={"/runs/" + data.runId}>
          Open source run
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigator.clipboard.writeText(data.id)}
        >
          Copy full analysis ID
        </Button>
        <span>
          Codebook <strong>revision {data.manifest.codebook.revision}</strong>
        </span>
        <span>
          Window / stride{" "}
          <strong>
            {data.manifest.settings.windowSize} / {data.manifest.settings.stride}
          </strong>
        </span>
        <span>
          Source boundary <strong>#{data.manifest.sequenceBoundary}</strong>
        </span>
        <span>
          Prepared <strong>{data.counters.prepared}</strong> · finished{" "}
          <strong>{data.counters.finished}</strong> · failed{" "}
          <strong>{data.counters.failed}</strong>
        </span>
      </div>
      {(job.error || windows.error) && (
        <Notice kind="warning">
          Connection stale: {(job.error || windows.error)?.message}. Saved
          results stay available.
        </Notice>
      )}
      {data.error && <Notice kind="error">{data.error}</Notice>}
      {job.command.error && (
        <Notice kind="error">{job.command.error.message}</Notice>
      )}
      {job.command.message && (
        <Notice kind="success">{job.command.message}</Notice>
      )}
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
