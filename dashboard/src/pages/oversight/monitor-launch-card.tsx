import { Eye, ShieldCheck } from "lucide-react";
import { Button, Card, CardHeading, Check } from "../../components/ui";

const RUNGS = [
  ["View 1", "Reports"],
  ["View 2", "+ audit metadata"],
  ["View 3", "+ board & deliveries"],
  ["View 4", "Full observable trace"],
] as const;
const LAYERS = ["reports", "audit", "board", "memory"];

/** The four views as a ladder: each rung adds one layer of evidence to the one below it. */
function EvidenceLadder() {
  return (
    <div>
      <div className="small muted rung" style={{ marginBottom: 6 }}>
        <span>Each view sees</span>
        <span className="blocks" style={{ textAlign: "center", fontSize: 11 }}>
          {LAYERS.map((layer) => <span key={layer}>{layer}</span>)}
        </span>
      </div>
      <div
        className="ladder"
        role="img"
        aria-label="Four evidence views, each adding one layer: reports; plus audit metadata; plus board and deliveries; plus private memory and reasoning"
      >
        {RUNGS.map(([name, sub], rung) => (
          <div className="rung" key={name}>
            <div className="rn">{name}<span>{sub}</span></div>
            <div className="blocks">
              {LAYERS.map((layer, layerIndex) => (
                <i key={layer} className={layerIndex <= rung ? "on" : "off"}>{layerIndex <= rung ? layerIndex + 1 : "·"}</i>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        No Jev scores, human labels or other views' results are ever included. View 4 records whether reasoning was available.
      </p>
    </div>
  );
}

/** The preview/launch rail: what will run, the evidence ladder, the preview control and its reason. */
export function MonitorLaunchCard({
  selectedCount,
  definitionRevision,
  outcomeCount,
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
  outcomeCount?: number;
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
      <div className="card-body" style={{ display: "grid", gap: 16 }}>
        <dl className="kv">
          <dt>Sources</dt>
          <dd>{selectedCount} completed runs</dd>
          <dt>Monitor calls</dt>
          <dd>{selectedCount * 4} · one isolated call per view</dd>
          <dt>Definitions</dt>
          <dd>
            {definitionRevision ? `Revision ${definitionRevision}` : "not selected"}
            {outcomeCount !== undefined && ` · ${outcomeCount} outcomes`}
          </dd>
          <dt>Monitor model</dt>
          <dd>{modelId || "not chosen yet"}</dd>
        </dl>
        <EvidenceLadder />
        <div style={{ display: "grid", gap: 8 }}>
          <Button variant={previewReady ? "secondary" : "default"} disabled={busy || prerequisites.length > 0} onClick={onPreview} style={{ width: "100%", height: 38 }}>
            <Eye size={15} />
            {busy ? "Preparing…" : "Preview four views"}
          </Button>
          {prerequisites.length > 0 ? (
            prerequisites.map((item) => <span className="why" key={item}>{item}</span>)
          ) : (
            <span className="why">Preview makes no model calls; launch freezes the definitions and settings.</span>
          )}
          {busy && (
            <p role="status" className="why">
              A request is in progress. Wait for it to finish before continuing.
            </p>
          )}
        </div>
        {previewReady && (
          <div style={{ display: "grid", gap: 10 }}>
            <dl className="kv">
              <dt>Estimated input</dt>
              <dd>
                {totalEstimatedTokens.toLocaleString()} tokens across {totalViews} views
              </dd>
            </dl>
            {unavailableViews > 0 && (
              <div className="oversight-oversize-warning" role="alert">
                <strong>
                  {unavailableViews} of {totalViews} views oversized / unavailable
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
              style={{ width: "100%" }}
            >
              <ShieldCheck size={15} />
              Launch monitor comparison
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
