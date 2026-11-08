import { useEffect, useState } from "react";
import { Field, Input, Select } from "../../components/ui";
import type { ThresholdPolicy } from "../../lib/analysis-types";
import { draftOf, policyOf, type PolicyDraft } from "./summary-view";

/**
 * Chooses the threshold policy. Invalid drafts are explained inline and never reach `onChange`, so the
 * summary on screen always matches a policy the server will accept.
 */
export function PolicyPicker({ policy, onChange }: { policy: ThresholdPolicy; onChange: (policy: ThresholdPolicy) => void }) {
  const [draft, setDraft] = useState<PolicyDraft>(() => draftOf(policy));
  useEffect(() => setDraft(draftOf(policy)), [policy]);
  const parsed = policyOf(draft);
  const edit = (patch: Partial<PolicyDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    const result = policyOf(next);
    if ("policy" in result) onChange(result.policy);
  };
  const thresholds = draft.kind !== "control-percentile";
  return (
    <div className="form-grid">
      <Field label="Threshold policy">
        <Select value={draft.kind} onChange={(e) => edit({ kind: e.target.value as PolicyDraft["kind"] })}>
          <option value="fixed">Fixed (documented starting point)</option>
          <option value="control-percentile">Percentile of control analyses</option>
          <option value="validated">Validated per code, fixed fallback</option>
        </Select>
      </Field>
      {thresholds && (
        <>
          <Field label={draft.kind === "validated" ? "Fallback yes at or above" : "Yes at or above"} hint="0 to 1">
            <Input inputMode="decimal" value={draft.yes} onChange={(e) => edit({ yes: e.target.value })} />
          </Field>
          <Field label={draft.kind === "validated" ? "Fallback no at or below" : "No at or below"} hint="0 to 1">
            <Input inputMode="decimal" value={draft.no} onChange={(e) => edit({ no: e.target.value })} />
          </Field>
        </>
      )}
      {!thresholds && (
        <>
          <Field label="Percentile" hint="0 to 1, e.g. 0.95">
            <Input inputMode="decimal" value={draft.percentile} onChange={(e) => edit({ percentile: e.target.value })} />
          </Field>
          <Field label="Control analysis IDs" hint="Completed analyses with the same codebook revision and model">
            <Input value={draft.controls} onChange={(e) => edit({ controls: e.target.value })} />
          </Field>
        </>
      )}
      {"error" in parsed && (
        <p className="field-error" role="alert">
          {parsed.error}
        </p>
      )}
    </div>
  );
}
