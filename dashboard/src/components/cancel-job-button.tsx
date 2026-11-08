import type { ReactNode } from "react";
import { Square } from "lucide-react";
import { Button } from "./ui";

/** One cancel-with-confirm control. Renders nothing for a terminal job. */
export function CancelJobButton({
  active,
  cancelRequested,
  busy,
  confirm,
  idleLabel,
  requestedLabel,
  onCancel,
}: {
  active: boolean;
  cancelRequested: boolean;
  busy: boolean;
  confirm: string;
  idleLabel: ReactNode;
  requestedLabel: ReactNode;
  onCancel(): Promise<void> | void;
}): ReactNode {
  if (!active) return null;
  return (
    <Button
      variant="destructive"
      disabled={busy || cancelRequested}
      onClick={async () => {
        if (!window.confirm(confirm)) return;
        await onCancel();
      }}
    >
      <Square size={13} />
      {cancelRequested ? requestedLabel : idleLabel}
    </Button>
  );
}
