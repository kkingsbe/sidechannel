import { useState } from "react";
import { BACKGROUND_PARTS, BEHAVIOR_KINDS, BEHAVIOR_SCOPES, type BackgroundPart, type BehaviorQuestion } from "@sidechannel/contracts/browser";
import { Button, Check, Field, Input, Notice, Select } from "../../components/ui";
import { ProseListEditor } from "../../components/prose-list-editor";
import type { useCodebookDraft } from "./use-codebook-draft";
import { formatSteps, isDynamicChoice, negationWarnings, parseSteps, questionError, withDefaults } from "./codebook-v2";
import { ValidationStatusSlot } from "./validation-status-slot";

const QUESTION_TYPES = [
  ["noul", "Presence (probability the behavior occurs)"],
  ["choice", "Choice (which one of several options)"],
  ["score", "Score (ordered severity levels)"],
] as const;

const DEFAULT_QUESTION: Record<BehaviorQuestion["type"], BehaviorQuestion> = {
  noul: { type: "noul" },
  choice: { type: "choice", options: [{ label: "", description: "" }, { label: "", description: "" }], allowNone: false },
  score: { type: "score", levels: ["", ""] },
};

/** Ordered steps keep their own state so a freshly added empty step survives until it is filled in. */
function DecisionProcedure({ value, onChange }: { value: string | undefined; onChange: (procedure: string | undefined) => void }) {
  const [steps, setSteps] = useState(() => parseSteps(value));
  return (
    <ProseListEditor
      label="Decision procedure step"
      values={steps}
      onChange={(next) => {
        setSteps(next);
        onChange(formatSteps(next));
      }}
    />
  );
}

function FramingExclusions({ values, onChange, disabled }: { values: string[]; onChange: (values: string[]) => void; disabled: boolean }) {
  const [phrase, setPhrase] = useState("");
  const add = () => {
    const next = phrase.trim();
    if (next && !values.includes(next)) onChange([...values, next]);
    setPhrase("");
  };
  return (
    <fieldset className="prose-list">
      <legend>Framing exclusions</legend>
      <p className="helper">Phrases from the task framing that must not count as evidence for this behavior.</p>
      <ul className="chips" aria-label="Framing exclusions">
        {values.map((value) => (
          <li key={value} className="chip">
            <span>{value}</span>
            <button type="button" aria-label={`Remove framing exclusion ${value}`} disabled={disabled} onClick={() => onChange(values.filter((item) => item !== value))}>×</button>
          </li>
        ))}
      </ul>
      <div className="two">
        <Field label="New framing exclusion">
          <Input value={phrase} disabled={disabled} onChange={(e) => setPhrase(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        </Field>
        <Button type="button" size="sm" variant="secondary" disabled={disabled || !phrase.trim()} onClick={add}>Add framing exclusion</Button>
      </div>
    </fieldset>
  );
}

function QuestionEditor({ draft }: { draft: ReturnType<typeof useCodebookDraft> }) {
  const code = withDefaults(draft.code!), q = code.question, disabled = draft.readOnly;
  const set = (question: BehaviorQuestion) => draft.edit({ question });
  return (
    <>
      <Field label="Question type">
        <Select value={q.type} disabled={disabled} onChange={(e) => set(DEFAULT_QUESTION[e.target.value as BehaviorQuestion["type"]])}>
          {QUESTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </Field>
      {q.type === "choice" && (
        <fieldset className="prose-list">
          <legend>Choice options</legend>
          {isDynamicChoice(code) ? (
            <p className="helper">This audit code has no stored options: they are the window&apos;s active agents, resolved when the request is built.</p>
          ) : (
            <p className="helper">2 to 255 options with unique labels.</p>
          )}
          {q.options.map((option, index) => (
            <div className="two" key={index}>
              <Field label={`Option ${index + 1} label`}>
                <Input value={option.label} disabled={disabled} onChange={(e) => set({ ...q, options: q.options.map((o, i) => (i === index ? { ...o, label: e.target.value } : o)) })} />
              </Field>
              <Field label={`Option ${index + 1} description`}>
                <Input value={option.description} disabled={disabled} onChange={(e) => set({ ...q, options: q.options.map((o, i) => (i === index ? { ...o, description: e.target.value } : o)) })} />
              </Field>
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => set({ ...q, options: q.options.filter((_, i) => i !== index) })}>Remove option {index + 1}</Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => set({ ...q, options: [...q.options, { label: "", description: "" }] })}>Add option</Button>
          <Check label="Add a none_of_these option" checked={q.allowNone} disabled={disabled} onChange={(e) => set({ ...q, allowNone: e.target.checked })} />
        </fieldset>
      )}
      {q.type === "score" && (
        <fieldset className="prose-list">
          <legend>Score levels</legend>
          <p className="helper">2 to 10 levels, lowest first.</p>
          {q.levels.map((level, index) => (
            <div className="two" key={index}>
              <Field label={`Level ${index + 1}`}>
                <Input value={level} disabled={disabled} onChange={(e) => set({ ...q, levels: q.levels.map((l, i) => (i === index ? e.target.value : l)) })} />
              </Field>
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => set({ ...q, levels: q.levels.filter((_, i) => i !== index) })}>Remove level {index + 1}</Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" disabled={disabled || q.levels.length >= 10} onClick={() => set({ ...q, levels: [...q.levels, ""] })}>Add level</Button>
        </fieldset>
      )}
    </>
  );
}

/** v2 per-code instrument controls: kind, scope, question, background, decision procedure, framing exclusions and inline warnings. */
export function CodeStudioControls({ draft }: { draft: ReturnType<typeof useCodebookDraft> }) {
  const raw = draft.code;
  if (!raw) return null;
  const code = withDefaults(raw), disabled = draft.readOnly;
  const live = negationWarnings(raw);
  const warnings = [...live, ...draft.savedWarnings.filter((w) => w.codeId === raw.id && !live.some((l) => l.field === w.field))];
  const error = questionError(raw);
  const toggle = (part: BackgroundPart, on: boolean) => draft.edit({ background: BACKGROUND_PARTS.filter((p) => (p === part ? on : code.background.includes(p))) });
  return (
    <section className="studio-controls" aria-label="Instrument settings">
      <h3>Instrument <ValidationStatusSlot code={raw} /></h3>
      {warnings.map((w) => (
        <Notice key={w.field} kind="warning">{w.message}</Notice>
      ))}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="two">
        <Field label="Kind" hint="Distractor and audit codes are scored alongside behavioral ones to absorb or flag attention.">
          <Select value={code.kind} disabled={disabled} onChange={(e) => draft.edit({ kind: e.target.value as typeof code.kind, ...(e.target.value === "audit" && code.scope === "actor" ? { scope: "window" as const } : {}) })}>
            {BEHAVIOR_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </Select>
        </Field>
        <Field label="Scope" hint="Actor scope asks the question once per active agent; not available for audit codes.">
          <Select value={code.scope} disabled={disabled} onChange={(e) => draft.edit({ scope: e.target.value as typeof code.scope })}>
            {BEHAVIOR_SCOPES.map((scope) => <option key={scope} value={scope} disabled={scope === "actor" && code.kind === "audit"}>{scope}</option>)}
          </Select>
        </Field>
      </div>
      <QuestionEditor draft={draft} />
      <fieldset className="prose-list">
        <legend>Background shown with this question</legend>
        {BACKGROUND_PARTS.map((part) => (
          <Check key={part} label={part === "task" ? "Task description" : "Policy"} checked={code.background.includes(part)} disabled={disabled} onChange={(e) => toggle(part, e.target.checked)} />
        ))}
        <p className="helper">The experimental condition is never classifier input, so it is not an option here.</p>
      </fieldset>
      <DecisionProcedure key={raw.id} value={raw.decisionProcedure} onChange={(decisionProcedure) => draft.edit({ decisionProcedure })} />
      <FramingExclusions values={code.framingExclusions} disabled={disabled} onChange={(framingExclusions) => draft.edit({ framingExclusions })} />
    </section>
  );
}
