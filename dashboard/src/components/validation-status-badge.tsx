import type { CodeValidation, ValidationStatus } from "@sidechannel/contracts/browser";
import { Badge } from "./ui";
import type { Tone } from "../lib/status";

const presentation: Record<ValidationStatus, { label: string; tone: Tone }> = {
  validated: { label: "Validated", tone: "success" },
  tentative: { label: "Tentative", tone: "info" },
  unreliable: { label: "Unreliable", tone: "danger" },
  unvalidated: { label: "Unvalidated", tone: "warning" },
};

/** Hover text: the rules that put the code in this status, or a plain statement when none are listed. */
export function validationReasons(validation: Pick<CodeValidation, "status" | "reasons">): string {
  if (validation.reasons.length) return validation.reasons.join("; ");
  return validation.status === "validated" ? "Meets every validation rule." : "No reason recorded.";
}

/**
 * The validation status of one code for a (codebook revision, model version) pair, with its reasons on hover.
 * Self-contained: it renders from a `CodeValidation` alone and imports nothing page-specific.
 */
export function ValidationStatusBadge({ validation }: { validation: Pick<CodeValidation, "status" | "reasons"> }) {
  const { label, tone } = presentation[validation.status];
  const reasons = validationReasons(validation);
  return (
    <span title={reasons} aria-label={`${label}: ${reasons}`} data-validation-status={validation.status}>
      <Badge tone={tone}>{label}</Badge>
    </span>
  );
}
