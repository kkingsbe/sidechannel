import { ArrowDown, ArrowUp, Archive, Copy } from "lucide-react";
import { Button, Card, CardHeading, Field, Input, Textarea } from "../../components/ui";
import { IdentityLine } from "../../components/identity-line";
import { ProseListEditor } from "../../components/prose-list-editor";
import type { useCodebookDraft } from "./use-codebook-draft";

const LISTS = [
  ["inclusionCriteria", "Inclusion criteria"],
  ["exclusionCriteria", "Exclusion criteria"],
  ["examples", "Examples"],
  ["counterexamples", "Counterexamples"],
  ["qualifyingEvidenceTypes", "Qualifying evidence / action types"],
] as const;

/** One behaviour definition: identity, definition, the ordered prose lists, then who saves it. */
export function BehaviorEditor({
  draft,
}: {
  draft: ReturnType<typeof useCodebookDraft>;
}) {
  const code = draft.code;
  if (!code) return null;
  const revision = draft.current?.revision;
  const next = (revision?.revision ?? 0) + 1;
  return (
    <Card>
      <CardHeading
        ruled
        title={code.name}
        description={
          <>
            Stable ID <span className="mono">{code.id}</span> · {code.enabled && !code.archived ? "enabled" : code.archived ? "archived" : "disabled"} in new analyses
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="icon" aria-label="Move code up" onClick={() => draft.reorder(-1)} disabled={draft.codes[0]?.id === draft.selected}>
              <ArrowUp size={15} />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Move code down" onClick={() => draft.reorder(1)} disabled={draft.codes.at(-1)?.id === draft.selected}>
              <ArrowDown size={15} />
            </Button>
            <Button variant="secondary" size="sm" onClick={draft.duplicate} disabled={draft.readOnly}>
              <Copy size={13} />
              Duplicate
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={draft.readOnly}
              onClick={() => draft.edit({ archived: !code.archived, enabled: code.archived })}
            >
              <Archive size={13} />
              {code.archived ? "Restore behaviour" : "Archive behaviour"}
            </Button>
          </>
        }
      />
      <div className="card-body" style={{ paddingTop: 16, display: "grid", gap: 16 }}>
        <div className="two">
          <Field required label="Display code" error={draft.validation.codeError(code)}>
            <Input value={code.code} onChange={(e) => draft.edit({ code: e.target.value })} />
          </Field>
          <Field required label="Display name">
            <Input value={code.name} onChange={(e) => draft.edit({ name: e.target.value })} />
          </Field>
        </div>
        <div className="two">
          <Field label="Stable ID" hint="Cannot change: past analyses refer to it.">
            <Input readOnly className="mono" value={code.id} />
          </Field>
          <Field label="Chart colour" hint="Codes are always identified by text as well as colour.">
            <Input type="color" value={code.color} onChange={(e) => draft.edit({ color: e.target.value })} />
          </Field>
        </div>
        <Field
          required
          label="Definition"
          hint="Required. Explain what this behaviour means in this study."
        >
          <Textarea
            rows={3}
            expandable
            editorLabel="Definition"
            value={code.definition}
            onChange={(e) => draft.edit({ definition: e.target.value })}
          />
        </Field>
        <div className="codebook-lists">
          <div className="two">
            {LISTS.slice(0, 2).map(([key, label]) => (
              <ProseListEditor key={key} label={label} values={code[key]} onChange={(values) => draft.edit({ [key]: values })} />
            ))}
          </div>
          <div className="two">
            {LISTS.slice(2, 4).map(([key, label]) => (
              <ProseListEditor key={key} label={label} values={code[key]} onChange={(values) => draft.edit({ [key]: values })} />
            ))}
          </div>
          {LISTS.slice(4).map(([key, label]) => (
            <ProseListEditor key={key} label={label} values={code[key]} onChange={(values) => draft.edit({ [key]: values })} />
          ))}
        </div>
      </div>
      <div className="card-foot editor-foot">
        <span>
          {draft.command.error
            ? "Save failed; your edits are retained."
            : draft.dirty
              ? `Edits are held until you save revision ${next}; analyses that used revision ${revision?.revision ?? "—"} keep it.`
              : "A behaviour label alone does not establish a violation or misconduct."}
        </span>
        <IdentityLine lead="Saving as" value={draft.author} onChange={draft.changeAuthor} inputLabel="Revision author" />
      </div>
    </Card>
  );
}
