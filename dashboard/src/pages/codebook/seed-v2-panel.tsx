import { Button, Card, CardHeading, ErrorState, Loading, Notice } from "../../components/ui";
import { diffSeed } from "./codebook-v2";
import type { useCodebookDraft } from "./use-codebook-draft";

/** Previews the v2 seed against the saved revision and, on confirmation, appends it as a new revision. */
export function SeedV2Panel({ draft }: { draft: ReturnType<typeof useCodebookDraft> }) {
  const { seed } = draft;
  if (!seed.open) return null;
  const saved = draft.current?.revision.codes ?? [];
  const diff = seed.proposal ? diffSeed(saved, seed.proposal) : undefined;
  const blocked = draft.dirty ? "Save or discard your unsaved edits first; the seed is applied on top of the saved revision." : !draft.author.trim() ? "Enter a revision author to apply the seed." : undefined;
  return (
    <Card style={{ marginBottom: 24 }}>
      <CardHeading
        title="Apply v2 seed revision"
        description={`Compares the v2 seed with saved revision ${draft.current?.revision.revision ?? "—"}. Nothing changes until you apply it, and earlier revisions stay frozen.`}
      />
      <div className="card-body">
        {seed.error ? (
          <ErrorState error={seed.error} retry={seed.show} />
        ) : !diff ? (
          <Loading />
        ) : (
          <>
            <p>
              {diff.added.length} added, {diff.changed.length} changed, {diff.unchanged} unchanged
              {diff.kept.length ? `, ${diff.kept.length} kept as they are` : ""}.
            </p>
            {diff.added.length > 0 && (
              <>
                <h4>Added</h4>
                <ul aria-label="Added codes">
                  {diff.added.map((code) => <li key={code.id}><b>{code.code}</b> ({code.kind ?? "behavioral"}, {code.question?.type ?? "noul"}): {code.definition}</li>)}
                </ul>
              </>
            )}
            {diff.changed.length > 0 && (
              <>
                <h4>Changed</h4>
                <ul aria-label="Changed codes">
                  {diff.changed.map((change) => <li key={change.id}><b>{change.code}</b>: {change.fields.join(", ")}</li>)}
                </ul>
              </>
            )}
            {diff.kept.length > 0 && <p className="helper">Not in the seed and left unchanged: {diff.kept.join(", ")}.</p>}
            {blocked && <Notice kind="warning">{blocked}</Notice>}
            <div className="actions">
              <Button onClick={seed.apply} disabled={!!blocked || draft.command.busy || draft.readOnly || (!diff.added.length && !diff.changed.length)}>Apply seed as revision {(draft.current?.revision.revision ?? 0) + 1}</Button>
              <Button variant="secondary" onClick={seed.close}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
