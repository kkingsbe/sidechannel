import { History, Plus, Save } from "lucide-react";
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
import { CodebookSelector } from "./codebook/codebook-selector";
import { RevisionHistoryDrawer } from "./codebook/revision-history-drawer";
import { useCodebookDraft } from "./codebook/use-codebook-draft";

export default function CodebookPage() {
  const draft = useCodebookDraft();
  const { command, validation, current } = draft;
  const saveDisabled = command.busy || draft.loading || !validation.readyToSave || draft.readOnly;
  return (
    <>
      <PageHeader
        eyebrow="VERSIONED BEHAVIOR DEFINITIONS"
        title="Research codebook"
        description="Define what Jev screens for. These exploratory codes are separate from run-level outcomes."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={draft.create}
              disabled={command.busy || draft.dirty}
            >
              <Plus size={15} />
              New codebook
            </Button>
            <Button
              variant="secondary"
              onClick={() => draft.setHistoryOpen(true)}
              disabled={!draft.bookId}
            >
              <History size={15} />
              Revision history
            </Button>
            <Button onClick={draft.save} disabled={saveDisabled}>
              <Save size={15} />
              Save revision
            </Button>
          </>
        }
      />
      <div className="save-status" role="status">
        {command.busy ? "Saving revision…" : validation.status}
        {draft.readOnly
          ? " This codebook is archived. Archive or restore actions do not change its frozen definitions."
          : " Saving creates a new immutable revision; it never overwrites an existing one."}
        {draft.dirty && (
          <p>
            Save these edits before creating another codebook. Your recovery copy
            is local to this browser.
          </p>
        )}
      </div>
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
        <Card>
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
      {draft.dirty && (
        <Notice>
          Unsaved codebook changes are kept in this browser. Saving creates a
          revision for future analyses only.
        </Notice>
      )}
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
            description="Create an empty study codebook and add behavior definitions through the editor."
          >
            <Button onClick={draft.create} disabled={command.busy}>
              <Plus size={14} />
              Create codebook
            </Button>
          </Empty>
        </Card>
      ) : (
        <>
          <CodebookSelector draft={draft} />
          {draft.loading ? (
            <Loading />
          ) : draft.error ? (
            <ErrorState error={draft.error} retry={draft.loadLatest} />
          ) : (
            <div className="split">
              <BehaviorList draft={draft} />
              {draft.code ? (
                <BehaviorEditor draft={draft} />
              ) : (
                <Empty title="Select a behavior definition" />
              )}
            </div>
          )}
        </>
      )}
      <RevisionHistoryDrawer draft={draft} />
    </>
  );
}
