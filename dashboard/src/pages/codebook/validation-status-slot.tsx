import type { BehaviorCode } from "../../lib/analysis-types";

/**
 * SLOT: the per-code validation status badge (spec 4.3) renders here. Another workstream replaces this placeholder with the badge for
 * the selected model version; it is mounted once per code in the studio controls, and `code.id` is the key into the validation
 * endpoint's per-code metrics. Keep the data attribute so tests can locate the mount point.
 */
export function ValidationStatusSlot({ code }: { code: BehaviorCode }) {
  return <span className="validation-status-slot" data-slot="validation-status" data-code-id={code.id} />;
}
