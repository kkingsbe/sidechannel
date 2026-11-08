import { Eye, ShieldCheck } from "lucide-react";
import { Button, Card, CardHeading, Check } from "../../components/ui";

/** The preview/launch aside: prerequisites, busy state and the explicit launch control. */
export function MonitorLaunchCard({
  selectedCount,
  definitionRevision,
  modelId,
  prerequisites,
  busy,
  previewReady,
  unavailableViews,
  totalViews,
  totalEstimatedTokens,
  acknowledged,
  onAcknowledged,
  onPreview,
  onLaunch,
}: {
  selectedCount: number;
  definitionRevision: number;
  modelId: string;
  prerequisites: string[];
  busy: boolean;
  previewReady: boolean;
  unavailableViews: number;
  totalViews: number;
  totalEstimatedTokens: number;
  acknowledged: boolean;
  onAcknowledged: (checked: boolean) => void;
  onPreview: () => void;
  onLaunch: () => void;
}) {
  return (
    <Card>
      <CardHeading title="Preview before execution" />
      <div className="card-body">
        <dl className="definition-list">
          <dt>Selected sources</dt>
          <dd>{selectedCount} completed runs</dd>
          <dt>Evidence views</dt>
          <dd>Four isolated invocations / run</dd>
          <dt>Definitions</dt>
          <dd>Revision {definitionRevision || "not selected"}</dd>
          <dt>Inference model</dt>
          <dd>{modelId || "Choose explicitly"}</dd>
        </dl>
        <hr className="section-divider" />
        <Button
          disabled={busy || prerequisites.length > 0}
          onClick={onPreview}
          style={{ width: "100%" }}
        >
          <Eye size={15} />
          {busy ? "Preparing…" : "Preview four views"}
        </Button>
        {prerequisites.length > 0 && (
          <div className="action-prerequisites">
            <strong>Before previewing</strong>
            <ul>
              {prerequisites.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {busy && (
          <p role="status" className="helper">
            A request is in progress. Wait for it to finish before continuing.
          </p>
        )}
        {previewReady && (
          <div className="oversight-preview-summary">
            <dl className="definition-list">
              <dt>Total estimated input</dt>
              <dd>
                {totalEstimatedTokens.toLocaleString()} tokens across{" "}
                {totalViews} views
              </dd>
            </dl>
            {unavailableViews > 0 && (
              <div className="oversight-oversize-warning" role="alert">
                <strong>
                  {unavailableViews} of {totalViews} views oversized /
                  unavailable
                </strong>
                <p>
                  Oversized views are not truncated; they are recorded as
                  unavailable and the comparison is partial. Raise the context
                  window or input limit, or accept this below.
                </p>
                <Check
                  label="Launch anyway; oversized views will be recorded as unavailable"
                  checked={acknowledged}
                  onChange={(e) => onAcknowledged(e.target.checked)}
                />
              </div>
            )}
            <Button
              disabled={busy || (unavailableViews > 0 && !acknowledged)}
              onClick={onLaunch}
              style={{ width: "100%", marginTop: 10 }}
            >
              <ShieldCheck size={15} />
              Launch monitor comparison
            </Button>
          </div>
        )}
        <p className="helper" style={{ marginTop: 12 }}>
          Preview makes no model calls. Launch freezes the complete definitions
          and model/settings. Jobs continue after closing this tab.
        </p>
      </div>
    </Card>
  );
}
