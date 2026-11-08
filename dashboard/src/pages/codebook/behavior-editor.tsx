import { ArrowDown, ArrowUp, Archive, Copy } from "lucide-react";
import { Button, Card, CardHeading, Check, Field, Input, Notice, Textarea } from "../../components/ui";
import { ProseListEditor } from "../../components/prose-list-editor";
import type { useCodebookDraft } from "./use-codebook-draft";

/** One behavior definition with ordered prose lists, enable/archive state and the save bar. */
export function BehaviorEditor({
  draft,
}: {
  draft: ReturnType<typeof useCodebookDraft>;
}) {
  const code = draft.code;
  if (!code) return null;
  return (
    <Card>
      <CardHeading
        title={code.name}
        description={`Stable internal ID Â· ${code.id}`}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Move code up"
              onClick={() => draft.reorder(-1)}
              disabled={draft.codes[0]?.id === draft.selected}
            >
              <ArrowUp size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Move code down"
              onClick={() => draft.reorder(1)}
              disabled={draft.codes.at(-1)?.id === draft.selected}
            >
              <ArrowDown size={15} />
            </Button>
          </>
        }
      />
      <div className="card-body form-grid">
        <Field
          required
          label="Display code"
          error={draft.validation.codeError(code)}
        >
          <Input
            value={code.code}
            onChange={(e) => draft.edit({ code: e.target.value })}
          />
        </Field>
        <Field required label="Display name">
          <Input
            value={code.name}
            onChange={(e) => draft.edit({ name: e.target.value })}
          />
        </Field>
        <Field
          required
          label="Definition"
          className="full"
          hint="Required. Explain what this behavior means in this study."
        >
          <Textarea
            rows={7}
            expandable
            editorLabel="Definition"
            value={code.definition}
            onChange={(e) => draft.edit({ definition: e.target.value })}
          />
        </Field>
        {(
          [
            "inclusionCriteria",
            "exclusionCriteria",
            "examples",
            "counterexamples",
            "qualifyingEvidenceTypes",
          ] as const
        ).map((key) => (
          <ProseListEditor
            key={key}
            label={
              {
                inclusionCriteria: "Inclusion criteria",
                exclusionCriteria: "Exclusion criteria",
                examples: "Examples",
                counterexamples: "Counterexamples",
                qualifyingEvidenceTypes: "Qualifying evidence / action types",
              }[key]
            }
            values={code[key]}
            onChange={(values) => draft.edit({ [key]: values })}
          />
        ))}
        <Field
          label="Chart color"
          hint="Codes are always identified by text as well as color."
        >
          <Input
            type="color"
            value={code.color}
            onChange={(e) => draft.edit({ color: e.target.value })}
          />
        </Field>
        <div className="full actions">
          <Check
            label="Enabled in new analyses"
            checked={code.enabled && !code.archived}
            disabled={code.archived}
            onChange={(e) => draft.edit({ enabled: e.target.checked })}
          />
          <Button variant="secondary" size="sm" onClick={draft.duplicate}>
            <Copy size={13} />
            Duplicate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              draft.edit({
                archived: !code.archived,
                enabled: code.archived,
              })
            }
          >
            <Archive size={13} />
            {code.archived ? "Restore" : "Archive"}
          </Button>
        </div>
        <Notice>
          Archiving preserves historical analyses and reviews. A behavior label
          alone does not establish a violation or misconduct.
        </Notice>
        <div className="full editor-save-bar">
          <span>
            {draft.dirty ? "Unsaved changes" : "Saved revision"}
            {draft.command.error ? " Â· Save failed; edits retained" : ""}
          </span>
          <Button
            onClick={draft.save}
            disabled={
              draft.command.busy ||
              draft.loading ||
              !draft.validation.readyToSave
            }
          >
            Save codebook edits
          </Button>
        </div>
      </div>
    </Card>
  );
}

