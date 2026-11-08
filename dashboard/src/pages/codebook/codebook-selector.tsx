import { Badge, Button, Notice, Select } from "../../components/ui";
import type { useCodebookDraft } from "./use-codebook-draft";

type Draft = ReturnType<typeof useCodebookDraft>;

/** The codebook picker as a compound filter ("Codebook | Study codebook"). */
export function CodebookPicker({ draft }: { draft: Draft }) {
  return (
    <>
      <span className="cf">
        <span>Codebook</span>
        <Select
          aria-label="Codebook"
          style={{ border: 0, height: 26, minHeight: 26, width: "auto", maxWidth: 220 }}
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
              {book.revision ? ` · r${book.revision}` : ""}
            </option>
          ))}
        </Select>
      </span>
      {draft.hasMoreBooks && (
        <Button variant="ghost" size="sm" onClick={draft.loadMoreBooks}>
          Load more codebooks
        </Button>
      )}
      {draft.selectedBook?.archivedAt && <Badge tone="warning">Archived</Badge>}
    </>
  );
}

/** Archive or restore the whole codebook: a small action in the list foot, with the reason when it cannot run. */
export function CodebookArchive({ draft }: { draft: Draft }) {
  const book = draft.selectedBook;
  if (!book) return null;
  const noAuthor = !draft.author.trim();
  return (
    <>
      <div className="actions">
        {book.archivedAt ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={draft.command.busy || noAuthor}
            onClick={() => void draft.setArchived(false)}
          >
            Restore codebook
          </Button>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            disabled={draft.command.busy || noAuthor || draft.dirty}
            onClick={() => void draft.setArchived(true)}
          >
            Archive codebook
          </Button>
        )}
        {noAuthor ? (
          <span className="why">Enter a revision author to archive or restore a codebook.</span>
        ) : !book.archivedAt && draft.dirty ? (
          <span className="why">Save or discard your unsaved edits before archiving.</span>
        ) : null}
      </div>
      {book.archivedAt && (
        <Notice kind="warning">
          This codebook is archived. Existing analyses keep their frozen definitions; restore it to
          edit or use it for new analyses.
        </Notice>
      )}
    </>
  );
}
