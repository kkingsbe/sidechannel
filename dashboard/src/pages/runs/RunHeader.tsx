import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Copy, Download } from "lucide-react";
import { Badge, Button, ConditionPill } from "../../components/ui";
import { CancelJobButton } from "../../components/cancel-job-button";
import { runStatusMeta } from "../../lib/status";
import { short, when } from "../../lib/utils";
import type { Run } from "../../lib/types";

const crumbBack = "crumb-back run-crumbs";

/** "Runs › pair name › Reviewed run": the way back, and where this run sits. */
export function RunCrumbs({ run, returnTo }: { run: Run; returnTo: string }) {
  const condition = run.config.condition.id;
  return (
    <nav className={crumbBack} aria-label="Breadcrumb">
      <Link to={returnTo}>Runs</Link>
      <ChevronRight size={12} aria-hidden="true" />
      {run.pairId ? (
        <Link className="trunc" to={"/runs/pairs/" + run.pairId + "?returnTo=" + encodeURIComponent(returnTo)}>
          {run.config.label}
        </Link>
      ) : (
        <span className="trunc">{run.config.label}</span>
      )}
      <ChevronRight size={12} aria-hidden="true" />
      <b>{condition.charAt(0).toUpperCase() + condition.slice(1)} run</b>
    </nav>
  );
}

export interface RunHeaderProps {
  run: Run;
  id: string;
  returnTo: string;
  /** "19 turns · 437 events in turns", once the turns are known. */
  scope?: string;
  active: boolean;
  following: boolean;
  onFollowChange(next: boolean): void;
  busy: boolean;
  onDuplicate(): void;
  exportUrl: string;
  onCancel(): Promise<void> | void;
  live?: React.ReactNode;
}

export function RunHeader({ run, id, returnTo, scope, active, following, onFollowChange, busy, onDuplicate, exportUrl, onCancel, live }: RunHeaderProps) {
  const [copied, setCopied] = useState(false);
  const meta = runStatusMeta[run.status];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  const live_ = active;
  return (
    <header className="objhead run-objhead">
      <div className="glyph" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 22 22">
          <rect x="2" y="4" width="18" height="5" rx="2.5" fill="var(--blue)" />
          <rect x="7" y="13" width="13" height="5" rx="2.5" fill="var(--blue)" opacity=".35" />
        </svg>
      </div>
      <div className="run-objhead-main">
        <div className="titleline">
          <h1>{run.config.label}</h1>
          <ConditionPill condition={run.config.condition.id} />
          <Badge tone={meta.tone}>
            {live_ && <span className="pulse" aria-hidden="true" />}
            {meta.label}
          </Badge>
        </div>
        <div className="meta">
          <span>
            {run.config.model.provider} / {run.config.model.id}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Round {run.round} of {run.config.scheduler.rounds} · turn {run.turn}
            {scope ? ` · ${scope}` : ""}
          </span>
          <span aria-hidden="true">·</span>
          <span className="mono small" title={id}>
            {short(id)}
          </span>
          <button type="button" className="run-copy" onClick={() => void copy()} aria-label={copied ? "Run ID copied" : "Copy run ID"}>
            <Copy size={12} aria-hidden="true" />
          </button>
          <span aria-hidden="true">·</span>
          <span>recorded {when(run.createdAt)}</span>
          {run.activeAgentId && active && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                acting: <strong>{run.activeAgentId}</strong>
              </span>
            </>
          )}
        </div>
      </div>
      <div className="actions run-actions">
        {live_ && (
          <button
            type="button"
            role="switch"
            aria-checked={following}
            className="run-switch"
            onClick={() => onFollowChange(!following)}
          >
            <span className="run-switch-track" aria-hidden="true">
              <span className="run-switch-thumb" />
            </span>
            Follow live
          </button>
        )}
        {live}
        {run.pairId && (
          <Button variant="secondary" asChild>
            <Link to={"/runs/pairs/" + run.pairId + "?returnTo=" + encodeURIComponent(returnTo)}>Compare pair</Link>
          </Button>
        )}
        <Button variant="secondary" onClick={onDuplicate} disabled={busy}>
          Duplicate config
        </Button>
        <Button variant="secondary" asChild>
          <a href={exportUrl} download>
            <Download size={14} />
            Export
          </a>
        </Button>
        <CancelJobButton
          active={active}
          cancelRequested={!!run.cancelRequested}
          busy={busy}
          confirm="Request cancellation? The worker will stop admitting new work and retain recorded evidence. An in-flight request may finish first."
          idleLabel={live_ ? "Stop run" : "Cancel run"}
          requestedLabel="Cancellation requested"
          onCancel={onCancel}
        />
      </div>
    </header>
  );
}
