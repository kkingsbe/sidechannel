import { History, Plus } from "lucide-react";
import {
  Button,
  Card,
  CardHeading,
  Empty,
  ErrorState,
  JsonView,
  Loading,
  Notice,
  PageHeader,
} from "../components/ui";
import { BehaviorEditor } from "./codebook/behavior-editor";
import { BehaviorList } from "./codebook/behavior-list";
import { CodebookPicker } from "./codebook/codebook-selector";
import { SeedV2Panel } from "./codebook/seed-v2-panel";
import { RevisionHistoryDrawer } from "./codebook/revision-history-drawer";
import { useCodebookDraft } from "./codebook/use-codebook-draft";
import "./codebook/codebook.css";

export default function CodebookPage() {
  const draft = useCodebookDraft();
  const { command, validation, current } = draft;
  const saveDisabled = command.busy || draft.loading || !validation.readyToSave || draft.readOnly;
  const saved = current?.revision.codes ?? [];
  const changed = draft.dirty
    ? draft.codes.filter((code) => {
        const before = saved.find((item) => item.id === code.id);
        return !before || JSON.stringify(before) !== JSON.stringify(code);
      }).length + saved.filter((item) => !draft.codes.some((code) => code.id === item.id)).length
    : 0;
  const enabled = draft.codes.filter((code) => code.enabled && !code.archived).length;
  const revisionNumber = current?.revision.revision;
  const nextRevision = (revisionNumber ?? 0) + 1;
  const finding = draft.books.length && current ? (
    <>
      <strong>
        {draft.name || current.codebook.name} · revision {revisionNumber} · {draft.codes.length} behaviours, {enabled} enabled.
      </strong>{" "}
      Jev scores every analysis window against these definitions; they are separate from run-level outcomes in Oversight.
    </>
  ) : (
    <>Jev scores every analysis window against these behaviour definitions; they are separate from run-level outcomes in Oversight.</>
  );
  const why = command.busy
    ? "Saving revision…"
    : draft.readOnly
      ? "This codebook is archived; its definitions are frozen."
      : draft.dirty
        ? validation.readyToSave
          ? `Unsaved changes in ${changed} ${changed === 1 ? "behaviour" : "behaviours"}`
          : validation.status
        : "No unsaved changes";
  return (
    <>
      <PageHeader
        title="Codebook"
        description={finding}
        actions={
          <>
            {draft.books.length > 0 && <CodebookPicker draft={draft} />}
            <Button variant="secondary" onClick={() => draft.setHistoryOpen(true)} disabled={!draft.bookId}>
              <History size={15} />
              Revision history
            </Button>
            <Button variant="secondary" onClick={draft.seed.show} disabled={!draft.bookId || draft.readOnly || command.busy}>
              Apply v2 seed revision
            </Button>
            <Button variant="secondary" onClick={draft.create} disabled={command.busy || draft.dirty}>
              <Plus size={15} />
              New codebook
            </Button>
            <span className="why" role="status">{why}</span>
            <Button onClick={draft.save} disabled={saveDisabled} aria-label="Save revision">
              Save revision {nextRevision}
            </Button>
          </>
        }
      />
      {command.error && (
        <Notice kind="error">
          {command.error.message}
          {"status" in command.error && command.error.status === 409 && (
            <div>
              <p>
                Another researcher saved a newer revision. Your edits are
                retained locally. Reload the latest revision, then reconcile your
                changes before saving.
              </p>
              <Button variant="secondary" onClick={draft.loadLatest}>
                Load latest for reconciliation
              </Button>
            </div>
          )}
        </Notice>
      )}
      {command.message && <Notice kind="success">{command.message}</Notice>}
      {draft.recovery && (
        <Card style={{ marginBottom: 24 }}>
          <CardHeading
            title="Recover edits from an older revision"
            description={`Your local edits started at revision ${draft.recovery.baseRevision}. The form below shows the latest saved revision ${current?.revision.revision}. Review both before saving.`}
          />
          <div className="card-body">
            <JsonView value={draft.recovery} title="Preserved local edits" />
            <JsonView value={current?.revision} title="Latest saved definitions" />
            <Button variant="secondary" onClick={draft.restoreRecovery}>
              Restore local edits for reconciliation
            </Button>
            <p className="helper">
              Restoring does not save. New definitions from the latest revision
              are retained; inspect changed fields before creating a revision.
            </p>
          </div>
        </Card>
      )}
      <SeedV2Panel draft={draft} />
      {validation.duplicateNames && (
        <Notice kind="error">
          Display codes must be unique among active definitions.
        </Notice>
      )}
      {draft.booksLoading ? (
        <Loading />
      ) : draft.booksError ? (
        <ErrorState error={draft.booksError} retry={draft.booksRefresh} />
      ) : !draft.books.length ? (
        <Card>
          <Empty
            title="Create the study codebook"
            description="Create an empty study codebook, then add the behaviours Jev should screen for."
          >
            <Button onClick={draft.create} disabled={command.busy}>
              <Plus size={14} />
              Create codebook
            </Button>
          </Empty>
        </Card>
      ) : draft.loading ? (
        <Loading />
      ) : draft.error ? (
        <ErrorState error={draft.error} retry={draft.loadLatest} />
      ) : (
        <div className="g12">
          <div className="c5">
            <BehaviorList draft={draft} />
          </div>
          <div className="c7">
            {draft.code ? (
              <BehaviorEditor draft={draft} />
            ) : (
              <Card>
                <Empty
                  title="Select a behaviour"
                  description="Choose a behaviour on the left to edit its definition."
                />
              </Card>
            )}
          </div>
        </div>
      )}
      <RevisionHistoryDrawer draft={draft} />
    </>
  );
}
