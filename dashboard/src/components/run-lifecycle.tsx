import * as Dialog from "@radix-ui/react-dialog";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import type { RunLifecycleBatch } from "../lib/clients/runs";
import type { Run } from "../lib/types";
import { short } from "../lib/utils";
import { Button, Notice } from "./ui";
import "./run-lifecycle.css";

const MAX_NAMED = 15;

/**
 * Explicit confirmation for the one irreversible run action. It names every run (label, condition,
 * short id) and says plainly that the deletion cannot be undone; nothing is sent until the researcher
 * presses the destructive button. An empty `runs` list keeps the dialog closed.
 */
export function RunDeleteDialog({
  runs,
  busy,
  onCancel,
  onConfirm,
}: {
  runs: Run[];
  busy: boolean;
  onCancel(): void;
  onConfirm(): Promise<void> | void;
}) {
  const many = runs.length > 1;
  return (
    <Dialog.Root open={runs.length > 0} onOpenChange={(open) => !open && !busy && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="confirm-dialog" role="alertdialog">
          <Dialog.Title>{many ? `Delete ${runs.length} runs permanently?` : "Delete this run permanently?"}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="confirm-body">
              <p>
                <strong>This cannot be undone.</strong> Each run's events, evidence, private agent memory and model traces are
                erased, and its launch key becomes available to launch again. If you only want runs out of the way, archive them
                instead.
              </p>
              <ul className="confirm-runs" aria-label="Runs to delete">
                {runs.slice(0, MAX_NAMED).map((run) => (
                  <li key={run.id}>
                    <strong>{run.config?.label || "Run"}</strong> · {run.config?.condition?.id} ·{" "}
                    <span className="mono">{short(run.id)}</span> · {run.status}
                  </li>
                ))}
                {runs.length > MAX_NAMED && <li>and {runs.length - MAX_NAMED} more</li>}
              </ul>
              <p className="muted small">
                Runs that analyses, reviews or monitor evaluations cite are refused, and so are runs the worker still owns.
              </p>
            </div>
          </Dialog.Description>
          <div className="confirm-actions">
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              Keep {many ? "runs" : "run"}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void onConfirm()}>
              <Trash2 size={14} aria-hidden="true" />
              {busy ? "Deleting…" : many ? `Delete ${runs.length} runs` : "Delete run"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Selection toolbar above the run table: what is selected and what can be done with it. */
export function RunSelectionBar({
  count,
  archivedView,
  busy,
  onArchive,
  onDelete,
  onClear,
}: {
  count: number;
  archivedView: boolean;
  busy: boolean;
  onArchive(): void;
  onDelete(): void;
  onClear(): void;
}) {
  if (!count) return null;
  return (
    <div className="selection-bar" role="region" aria-label="Selected runs">
      <strong>{count} selected</strong>
      <Button variant="secondary" size="sm" disabled={busy} onClick={onArchive}>
        {archivedView ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
        {archivedView ? "Unarchive" : "Archive"}
      </Button>
      <Button variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
        <Trash2 size={14} aria-hidden="true" />
        Delete…
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}

/** Per-run outcome of a bulk request; silent when every run succeeded. */
export function BatchOutcome({ batch, runs }: { batch?: RunLifecycleBatch; runs: Run[] }) {
  if (!batch) return null;
  const name = (id: string) => runs.find((run) => run.id === id)?.config?.label ?? short(id);
  const verb = { archive: "archived", unarchive: "unarchived", delete: "deleted" }[batch.action];
  return (
    <Notice kind={batch.failed ? "warning" : "success"}>
      {batch.succeeded} {batch.succeeded === 1 ? "run" : "runs"} {verb}
      {batch.failed ? `; ${batch.failed} could not be ${verb}:` : "."}
      {batch.failed > 0 && (
        <ul className="batch-failures">
          {batch.results
            .filter((result) => !result.ok)
            .map((result) => (
              <li key={result.id}>
                <span className="mono">{name(result.id)}</span> — {result.error}
              </li>
            ))}
        </ul>
      )}
    </Notice>
  );
}
