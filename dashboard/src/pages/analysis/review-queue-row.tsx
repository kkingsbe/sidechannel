import { Button } from "../../components/ui";
import { useApi } from "../../lib/api";
import { useClients } from "../../lib/clients/context";
import type { AnalysisJob, HumanReview, Page, ReviewSelection, WindowDetail } from "../../lib/analysis-types";

export function ReviewQueueRow({
  job,
  selection,
  index,
  reviewer,
  blind,
  onSelect,
}: {
  job: AnalysisJob;
  selection: ReviewSelection;
  index: number;
  reviewer: string;
  blind: boolean;
  onSelect: (id: string) => void;
}) {
  const clients = useClients();
  const detail = useApi<WindowDetail>(
    clients.analyses.paths.window(job.id, selection.windowId),
  );
  const reviews = useApi<Page<HumanReview>>(
    reviewer.trim()
      ? clients.analyses.paths.reviews(job.id, { windowId: selection.windowId, reviewer, latest: "true", limit: 30 })
      : null,
  );
  const own =
    reviews.data?.items.filter(
      (r) =>
        r.reviewer === reviewer.trim() &&
        (r.subjectId === selection.windowId || r.windowId === selection.windowId),
    ) ?? [];
  return (
    <tr>
      <td>
        <strong>
          {detail.data
            ? `Window ${detail.data.window.index + 1}  -  steps ${detail.data.window.startStep} - ${detail.data.window.endStep}`
            : `Review item ${index + 1}`}
        </strong>
        {detail.data && (
          <small className="analysis-id">
            {detail.data.window.partial ? "Partial window" : "Full boundaries"}
            {detail.data.window.incomplete ? "  -  Incomplete evidence" : ""}
          </small>
        )}
      </td>
      <td>
        {!reviewer.trim()
          ? "Enter reviewer identity"
          : reviews.loading
            ? "Loading review progress"
            : reviews.error || !reviews.data
              ? "Progress unavailable"
              : own.length
                ? own.some((r) => r.revision > 1)
                  ? "Revised"
                  : "Saved"
                : "Unreviewed"}
      </td>
      <td>
        {blind
          ? "Hidden in blind mode"
          : selection.reasons?.join(" + ") || "Unavailable"}
      </td>
      <td>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSelect(selection.windowId)}
        >
          Review evidence
        </Button>
      </td>
    </tr>
  );
}
