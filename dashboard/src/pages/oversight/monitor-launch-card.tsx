import { Eye, ShieldCheck } from "lucide-react";
import { Button, Card, CardHeading } from "../../components/ui";

/** The preview/launch aside: prerequisites, busy state and the explicit launch control. */
export function MonitorLaunchCard({
  selectedCount,
  definitionRevision,
  modelId,
  prerequisites,
  busy,
  previewReady,
  onPreview,
  onLaunch,
}: {
  selectedCount: number;
  definitionRevision: number;
  modelId: string;
  prerequisites: string[];
  busy: boolean;
  previewReady: boolean;
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
          <Button
            disabled={busy}
            onClick={onLaunch}
            style={{ width: "100%", marginTop: 10 }}
          >
            <ShieldCheck size={15} />
            Launch monitor comparison
          </Button>
        )}
        <p className="helper" style={{ marginTop: 12 }}>
          Preview makes no model calls. Launch freezes the complete definitions
          and model/settings. Jobs continue after closing this tab.
        </p>
      </div>
    </Card>
  );
}
