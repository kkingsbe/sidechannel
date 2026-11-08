import { Button, Card, CardHeading, Notice } from "../../components/ui";
import { Link } from "react-router-dom";
import { Eye, Play } from "lucide-react";
import type { AnalysisSetupState } from "./analysis-setup";

export function PreviewLaunch({ state }: { state: AnalysisSetupState }) {
  const { books, settings, launch, doPreview, currentRevision, prerequisites, scoreable, preview, mutation } = state;
  return (
    <>
      <Card>
        <CardHeading ruled title="Preview & launch" />
        <div className="card-body an-body">
          <dl className="kv">
            <dt>Worker</dt>
            <dd>Independent analysis worker</dd>
            <dt>Code revision</dt>
            <dd>{currentRevision?.revision ?? "Not selected"}</dd>
            <dt>Model</dt>
            <dd>{settings.model}</dd>
            <dt>Overlap</dt>
            <dd>{Math.max(0, settings.windowSize - settings.stride)} steps</dd>
            <dt>Request volume</dt>
            <dd>
              {preview
                ? preview.windows.reduce(
                    (n, w) => n + (w.budget.oversized ? 0 : w.budget.batches.length),
                    0,
                  ) + " estimated requests"
                : "Preview required"}
            </dd>
          </dl>
          {preview && (
            <div role="status" className="an-preflight">
              <strong>{scoreable} scoreable windows</strong>
              <p className="small muted">
                {preview.windows.filter((w) => w.budget.oversized).length} oversized -{" "}
                {preview.windows.filter((w) => w.partial).length} partial -{" "}
                {preview.windows.length - scoreable} unscored
              </p>
              {scoreable === 0 ? (
                <p>
                  No scores will be produced. Adjust Windowing &amp; evidence, or explicitly save an
                  unscored record.
                </p>
              ) : (
                <p>
                  {scoreable} windows will be scored; {preview.windows.length - scoreable} remain
                  unscored.
                </p>
              )}
            </div>
          )}
          <div className="an-launch">
            <Button
              variant={preview ? "secondary" : "default"}
              aria-describedby={prerequisites.length ? "analysis-prerequisites" : undefined}
              onClick={doPreview}
              disabled={mutation.busy || prerequisites.length > 0}
            >
              <Eye size={15} />
              {mutation.busy ? "Preparing…" : "Preview analysis"}
            </Button>
            {prerequisites.length > 0 && (
              <div className="why" id="analysis-prerequisites">
                <ul>
                  {prerequisites.map((item) => (
                    <li key={String(item)}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview && (
              <Button onClick={launch} disabled={mutation.busy}>
                <Play size={14} />
                {scoreable ? "Launch analysis job" : "Save unscored analysis record"}
              </Button>
            )}
          </div>
        </div>
        <div className="card-foot">
          <span>Estimates are not a guaranteed bill. Nothing is truncated or split; the worker continues after you leave.</span>
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
