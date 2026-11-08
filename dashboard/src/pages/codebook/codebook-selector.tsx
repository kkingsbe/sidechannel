import { REVIEWER_STORAGE_KEY } from "../../components/claimed-reviewer";
import { Badge, Button, Field, Input, Notice, Select } from "../../components/ui";
import type { useCodebookDraft } from "./use-codebook-draft";

/** Codebook choice, editable name and claimed revision author. */
export function CodebookSelector({
  draft,
}: {
  draft: ReturnType<typeof useCodebookDraft>;
}) {
  return (
    <div className="form-grid three" style={{ marginBottom: 20 }}>
      <Field label="Codebook">
        <Select
          value={draft.bookId}
          onChange={(e) => {
            if (
              draft.dirty &&
              !window.confirm(
                "Switch codebook? Your unsaved changes are retained in this browser.",
              )
            )
              return;
            draft.selectBook(e.target.value);
          }}
        >
          {draft.books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.name}
              {book.revision ? ` Â· r${book.revision}` : ""}
            </option>
          ))}
        </Select>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.showArchived}
            onChange={(e) => draft.changeShowArchived(e.target.checked)}
          />
          Show archived codebooks
        </label>
        {draft.selectedBook?.archivedAt && (
          <Badge tone="warning">Archived</Badge>
        )}
        {draft.hasMoreBooks && (
          <Button
            variant="ghost"
            size="sm"
            onClick={draft.loadMoreBooks}
          >
            Load more codebooks
          </Button>
        )}
      </Field>
      <Field
        label="Codebook name"
        required
        error={draft.dirty ? draft.validation.nameError : undefined}
      >
        <Input
          value={draft.name}
          onChange={(e) => {
            draft.setName(e.target.value);
          }}
        />
      </Field>
      <Field
        required
        label="Revision author"
        hint="Claimed identity in this open workspace, not an authenticated account."
      >
        <Input
          value={draft.author}
          onChange={(e) => {
            draft.setAuthor(e.target.value);
            localStorage.setItem(REVIEWER_STORAGE_KEY, e.target.value);
          }}
        />
      </Field>
      <div className="full">
        {draft.selectedBook && (
          <>
            <div className="actions">
              {draft.selectedBook.archivedAt ? (
                <Button
                  variant="secondary"
                  disabled={draft.command.busy || !draft.author.trim()}
                  onClick={() => void draft.setArchived(false)}
                >
                  Restore codebook
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={draft.command.busy || !draft.author.trim() || draft.dirty}
                  onClick={() => void draft.setArchived(true)}
                >
                  Archive codebook
                </Button>
              )}
            </div>
            {!draft.author.trim() && (
              <p className="helper">Enter a revision author to archive or restore a codebook.</p>
            )}
            {!draft.selectedBook.archivedAt && draft.dirty && (
              <p className="helper">Save or discard your unsaved edits before archiving this codebook.</p>
            )}
            {draft.selectedBook.archivedAt && (
              <Notice kind="warning">
                This codebook is archived. Existing analyses keep their frozen definitions; restore it to
                edit or use it for new analyses.
              </Notice>
            )}
          </>
        )}
      </div>
    </div>
  );
}

