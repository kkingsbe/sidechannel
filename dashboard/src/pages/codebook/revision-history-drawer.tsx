import { Button, Drawer, ErrorState, Loading } from "../../components/ui";
import { when } from "../../lib/utils";
import type { useCodebookDraft } from "./use-codebook-draft";

/** Immutable revision history with the selected revision's definitions. */
export function RevisionHistoryDrawer({
  draft,
}: {
  draft: ReturnType<typeof useCodebookDraft>;
}) {
  return (
    <Drawer
      open={draft.historyOpen}
      onOpenChange={draft.setHistoryOpen}
      title="Codebook revision history"
      description="Immutable definitions used by past and future analyses."
    >
      {draft.revisionsLoading ? (
        <Loading />
      ) : draft.revisionsError ? (
        <ErrorState
          error={draft.revisionsError}
          retry={draft.revisionsPage.back}
        />
      ) : (
        draft.revisions.map((revision) => (
          <button
            key={revision.id}
            className="list-button"
            onClick={() => draft.selectRevision(revision)}
          >
            <div>
              <strong>
                Revision {revision.revision} · {revision.name}
              </strong>
              <small>
                {when(revision.createdAt)} · {revision.author} ·{" "}
                {revision.codes.length} definitions
              </small>
            </div>
          </button>
        ))
      )}
      {draft.historyRevision && (
        <div style={{ marginTop: 24 }}>
          <h3>Revision {draft.historyRevision.revision}</h3>
          {draft.historyRevision.codes.map((code) => (
            <div style={{ marginTop: 14 }} key={code.id}>
              <strong>
                {code.code} · {code.name}
              </strong>
              <p className="helper">{code.definition}</p>
            </div>
          ))}
        </div>
      )}
      <div className="actions">
        <Button
          variant="secondary"
          disabled={draft.revisionsPage.page === 0 || draft.revisionsLoading}
          onClick={draft.revisionsPage.back}
        >
          Previous revisions
        </Button>
        <Button
          variant="secondary"
          disabled={!draft.revisionsPage.hasMore || draft.revisionsLoading}
          onClick={() => draft.revisionsPage.onChange(draft.revisionsPage.page + 1)}
        >
          Next revisions
        </Button>
      </div>
    </Drawer>
  );
}
