import { Button, Field, Input, Select } from "../../components/ui";
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
            localStorage.setItem("sidechannel-reviewer", e.target.value);
          }}
        />
      </Field>
    </div>
  );
}

