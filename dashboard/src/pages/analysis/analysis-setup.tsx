import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Button,
  Drawer,
  JsonView,
  Notice,
  PageHeader,
} from "../../components/ui";
import { useClients } from "../../lib/clients/context";
import { useClaimedReviewer } from "../../components/claimed-reviewer";
import { useResource, useResourceOffsetPage, useResourcePage } from "../../lib/clients/query";
import type { AnalysisJob, CodebookRevision } from "../../lib/analysis-types";
import type { OffsetPage } from "../../lib/contracts";
import type { Run } from "../../lib/types";
import { useAnalysisDraft } from "./use-analysis-draft";
import { useCodebookPicker } from "./use-codebook-picker";
import { usePreview } from "./use-preview";
import { SourceSection } from "./source-section";
import { WindowingSection } from "./windowing-section";
import { PreparedWindows } from "./prepared-windows";
import { SavedAnalyses } from "./saved-analyses";
import { PreviewLaunch } from "./preview-launch";
import { PreviewWindowInput } from "./preview-window-input";

/** The analysis setup shell: composes the three draft hooks and the section views. */
function useAnalysisSetup() {
  const clients = useClients();
  const [params, setParams] = useSearchParams();
  const runId = params.get("run") || "";
  const clone = params.get("clone");
  const { reviewer: defaultCreator } = useClaimedReviewer();
  const runs = useResourceOffsetPage<Run>(
    "analysis:setup:runs",
    async (offset) =>
      (await clients.runs.list({
        summary: true,
        limit: 50,
        offset,
      })) as unknown as OffsetPage<Run>,
    { pageSize: 50 },
  );
  const source = useResource<Run>(
    runId ? `analysis:setup:source:${runId}` : null,
    () => clients.runs.get(runId),
  );
  const cloned = useResource<AnalysisJob>(
    clone ? `analysis:setup:clone:${clone}` : null,
    () => clients.analyses.job(clone!),
  );
  const jobs = useResourcePage<AnalysisJob>(
    runId ? `analysis:setup:jobs:${runId}` : null,
    (cursor) =>
      clients.analyses.runJobs(runId, {
        limit: 30,
        after: cursor ?? undefined,
      }),
    { interval: 5000 },
  );
  const draft = useAnalysisDraft({
    runId,
    sourceStatus: source.data?.status,
    defaultCreator,
  });
  const picker = useCodebookPicker({
    settings: draft.settings,
    change: draft.change,
  });
  const preview = usePreview({ runId, settings: draft.settings });
  useEffect(() => {
    if (!cloned.data) return;
    draft.adoptClone(cloned.data);
    preview.clear();
    if (!runId)
      setParams((prev) => {
        prev.set("run", cloned.data!.runId);
        return prev;
      });
  }, [cloned.data]);
  const change = (patch: Parameters<typeof draft.change>[0]) => {
    draft.change(patch);
    preview.clear();
  };
  return {
    runId,
    setParams,
    runs,
    source,
    books: picker.books,
    revision: picker.revision,
    revisionHistory: picker.revisionHistory,
    currentRevision: picker.currentRevision,
    jobs,
    settings: draft.settings,
    change,
    launch: preview.launch,
    doPreview: preview.prepare,
    prerequisites: draft.prerequisites,
    scoreable: preview.scoreable,
    preview: preview.preview,
    previewWindow: preview.previewWindow,
    setPreviewWindow: preview.setPreviewWindow,
    setPreview: (_value?: unknown) => preview.clear(),
    mutation: {
      busy: preview.busy,
      error: preview.error,
      message: preview.message,
    },
  };
}

export type AnalysisSetupState = ReturnType<typeof useAnalysisSetup>;

export function AnalysisSetup() {
  const state = useAnalysisSetup();
  const { mutation, preview, previewWindow, setPreviewWindow } = state;
  return (
    <>
      <Button asChild variant="ghost">
        <Link to="/analysis">All analyses</Link>
      </Button>
      <PageHeader
        eyebrow="JEV · WINDOW-LEVEL SCREENING"
        title="Trace analysis"
        description="Estimate behaviors in overlapping source windows, then inspect the actual evidence."
      />
      {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
      <Notice>
        Jev estimates support researcher exploration. They are never delivered to
        agents or oversight monitors, and do not establish run-level outcomes.
      </Notice>
      <div className="editor-layout">
        <div>
          <SourceSection state={state} />
          <WindowingSection state={state} />
          <PreparedWindows state={state} />
          <SavedAnalyses state={state} />
        </div>
        <aside className="stack sticky">
          <PreviewLaunch state={state} />
        </aside>
      </div>
      <Drawer
        open={!!previewWindow}
        onOpenChange={(open) => {
          if (!open) setPreviewWindow(undefined);
        }}
        title={
          previewWindow
            ? `Preview window ${previewWindow.index + 1}`
            : "Preview window"
        }
      >
        {previewWindow && (
          <>
            <dl className="definition-list">
              <dt>Source range</dt>
              <dd>
                {previewWindow.startStep}–{previewWindow.endStep}
              </dd>
              <dt>Input hash / budget</dt>
              <dd>
                {previewWindow.budget.bytes.toLocaleString()} bytes ·{" "}
                {previewWindow.budget.estimatedTokens.toLocaleString()} estimated
                tokens
              </dd>
            </dl>
            {previewWindow.budget.oversized && (
              <Notice kind="warning">
                {previewWindow.budget.reason ||
                  "This fixed window exceeds the provider budget and will have missing scores."}
              </Notice>
            )}
            {previewWindow.state ? (
              <JsonView
                value={previewWindow.state}
                title="Exact serialized evidence"
              />
            ) : (
              <PreviewWindowInput
                token={preview?.previewToken}
                windowId={previewWindow.id}
              />
            )}
          </>
        )}
      </Drawer>
    </>
  );
}

export type { CodebookRevision };
