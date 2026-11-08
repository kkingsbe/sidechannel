import { useEffect, useState } from "react";
import { Check, Input } from "../../components/ui";
import type { BehaviorCode } from "../../lib/analysis-types";

/** Display-only threshold in whole percent; the draft text lets the field be cleared while typing. */
export function ThresholdInput({
  threshold,
  onChange,
}: {
  threshold: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(threshold * 100)));
  useEffect(() => {
    setDraft((d) => (Number(d) === Math.round(threshold * 100) ? d : String(Math.round(threshold * 100))));
  }, [threshold]);
  return (
    <>
      <label className="small muted" htmlFor="analysis-threshold">
        Highlight at
      </label>
      <Input
        id="analysis-threshold"
        className="an-threshold"
        type="number"
        min="0"
        max="100"
        step="5"
        value={draft}
        aria-label="Highlight threshold, percent (display only)"
        onChange={(e) => {
          setDraft(e.target.value);
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(Math.min(100, Math.max(0, n)) / 100);
        }}
      />
      <span className="small muted">%</span>
    </>
  );
}

/** "Behaviours | All 9" compound filter that opens a checklist. */
export function BehaviourFilter({
  codes,
  visible,
  onChange,
}: {
  codes: BehaviorCode[];
  visible: string[] | undefined;
  onChange: (ids: string[] | undefined) => void;
}) {
  const current = visible ?? codes.map((c) => c.id);
  const count = codes.filter((c) => current.includes(c.id)).length;
  return (
    <details className="cf an-menu">
      <summary>
        <span>Behaviours</span>
        <b>{count === codes.length ? `All ${codes.length}` : `${count} of ${codes.length}`}</b>
      </summary>
      <div className="an-menu-list">
        {codes.map((code) => (
          <Check
            key={code.id}
            label={code.code}
            checked={current.includes(code.id)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...current, code.id] : current.filter((id) => id !== code.id),
              )
            }
          />
        ))}
      </div>
    </details>
  );
}
