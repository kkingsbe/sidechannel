import { Button, Card, CardHeading, Notice } from "../../components/ui";
import { Link } from "react-router-dom";
import { Eye, Play } from "lucide-react";
import type { AnalysisPreview, Codebook, CodebookRevision } from "../../lib/analysis-types";
import type { AnalysisSetupState } from "./analysis-setup";

export function PreviewLaunch({ state }: { state: AnalysisSetupState }) {
  const { books, revision, settings, launch, doPreview, currentRevision, prerequisites, scoreable, preview, mutation } = state;
  return (
    <>
          <Card>
            <CardHeading title="Preview & launch" />
            <div className="card-body">
              <dl className="definition-list">
                <dt>Worker</dt>
                <dd>Independent analysis worker</dd>
                <dt>Code revision</dt>
                <dd>{currentRevision?.revision ?? "Not selected"}</dd>
                <dt>Model</dt>
                <dd>{settings.model}</dd>
                <dt>Overlap</dt>
                <dd>
                  {Math.max(0, settings.windowSize - settings.stride)} steps
                </dd>
                <dt>Request volume</dt>
                <dd>
                  {preview
                    ? preview.windows.reduce(
                        (n, w) =>
                          n +
                          (w.budget.oversized ? 0 : w.budget.batches.length),
                        0,
                      ) + " estimated requests"
                    : "Preview required"}
                </dd>
              </dl>
              <hr className="section-divider" />
              {prerequisites.length > 0 && (
                <div className="helper" id="analysis-prerequisites">
                  <strong>Before previewing:</strong>
                  <ul>
                    {prerequisites.map((item) => (
                      <li key={String(item)}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {preview && (
                <div role="status" className="analysis-preflight">
                  <strong>{scoreable} scoreable windows</strong>
                  <p>
                    {preview.windows.filter((w) => w.budget.oversized).length}{" "}
                    oversized -{" "}
                    {preview.windows.filter((w) => w.partial).length} partial -{" "}
                    {preview.windows.length - scoreable} unscored
                  </p>
                  {scoreable === 0 ? (
                    <p>
                      No scores will be produced. Adjust Windowing &amp;
                      evidence, or explicitly save an unscored record.
                    </p>
                  ) : (
                    <p>
                      {scoreable} windows will be scored;{" "}
                      {preview.windows.length - scoreable} remain unscored.
                    </p>
                  )}
                </div>
              )}
              <Button
                aria-describedby={
                  prerequisites.length ? "analysis-prerequisites" : undefined
                }
                onClick={doPreview}
                disabled={mutation.busy || prerequisites.length > 0}
                style={{ width: "100%" }}
              >
                <Eye size={15} />
                {mutation.busy ? "Preparing…" : "Preview analysis"}
              </Button>
              {preview && (
                <Button
                  onClick={launch}
                  disabled={mutation.busy}
                  style={{ width: "100%", marginTop: 10 }}
                >
                  <Play size={14} />
                  {scoreable
                    ? "Launch analysis job"
                    : "Save unscored analysis record"}
                </Button>
              )}
              <p className="helper" style={{ marginTop: 12 }}>
                Estimates are not a guaranteed bill. No automatic truncation,
                shrinking, or splitting. You can leave after launch; the worker
                continues.
              </p>
            </div>
          </Card>
          {!books.data.length && !books.loading && (
            <Notice>
              Start by creating a{" "}
              <Link className="table-title" to="/codebook">
                research codebook
              </Link>
              .
            </Notice>
          )}
    </>
  );
}
