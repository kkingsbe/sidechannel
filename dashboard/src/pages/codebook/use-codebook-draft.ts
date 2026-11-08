import { useEffect, useState } from "react";
import { REVIEWER_STORAGE_KEY } from "../../components/claimed-reviewer";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import { useResource, useResourcePage } from "../../lib/clients/query";
import type {
  BehaviorCode,
  Codebook,
  CodebookRevision,
} from "../../lib/analysis-types";
import { duplicateCode, moveCode, readLocalDraft, STORAGE_PREFIX } from "./codebook-draft-state";
import { validateCodebook } from "./validate-codebook";


/** Selection, hydrating draft, recovery, immutable saves and revision history for one codebook. */
export function useCodebookDraft() {
  const clients = useClients();
  const [showArchived, setShowArchived] = useState(false);
  const booksPage = useResourcePage<Codebook>(
    showArchived ? "codebooks:with-archived" : "codebooks",
    (cursor) =>
      clients.codebooks.list({
        limit: 30,
        after: cursor ?? undefined,
        ...(showArchived ? { archived: "include" as const } : {}),
      }),
  );
  const [bookOptions, setBookOptions] = useState<Codebook[]>([]);
  const [bookId, setBookId] = useState("");
  const current = useResource(bookId ? `codebook:${bookId}` : null, () =>
    clients.codebooks.get(bookId),
  );
  const [codes, setCodes] = useState<BehaviorCode[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [author, setAuthor] = useState(
    () => localStorage.getItem(REVIEWER_STORAGE_KEY) || "",
  );
  const [dirty, setDirty] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formBookId, setFormBookId] = useState("");
  const [baseRevisionId, setBaseRevisionId] = useState("");
  const [baseRevision, setBaseRevision] = useState(0);
  const [recovery, setRecovery] = useState<{
    name: string;
    codes: BehaviorCode[];
    baseRevision: number;
  }>();
  const revisions = useResourcePage<CodebookRevision>(
    historyOpen && bookId ? `codebook:${bookId}:revisions` : null,
    (cursor) =>
      clients.codebooks.revisions(bookId, {
        limit: 30,
        after: cursor ?? undefined,
      }),
  );
  const [historyRevision, setHistoryRevision] = useState<CodebookRevision>();
  const command = useCommand();
  useEffect(() => {
    if (booksPage.data)
      setBookOptions((previous) => [
        ...new Map(
          [...previous, ...booksPage.data].map((book) => [book.id, book]),
        ).values(),
      ]);
  }, [booksPage.data]);
  useEffect(() => setHistoryRevision(undefined), [bookId]);
  useEffect(() => {
    if (!bookId && booksPage.data[0]) setBookId(booksPage.data[0].id);
  }, [booksPage.data, bookId]);
  useEffect(() => {
    if (!current.data || current.data.codebook.id !== bookId) return;
    setFormBookId(current.data.codebook.id);
    setBaseRevisionId(current.data.revision.id);
    setBaseRevision(current.data.revision.revision);
    setRecovery(undefined);
    const { restored, recovery: older } = readLocalDraft(
      current.data.codebook.id,
      current.data.codebook.revision,
    );
    if (restored) {
      setCodes(restored.codes);
      setName(restored.name);
      setSelected(restored.codes[0]?.id || "");
      setDirty(true);
      return;
    }
    if (older) setRecovery(older);
    setCodes(structuredClone(current.data.revision.codes));
    setName(current.data.codebook.name);
    setSelected(current.data.revision.codes[0]?.id || "");
    setDirty(false);
  }, [current.data, bookId]);
  useEffect(() => {
    if (dirty && formBookId && formBookId === bookId)
      localStorage.setItem(
        STORAGE_PREFIX + bookId,
        JSON.stringify({ codes, name, baseRevision }),
      );
  }, [codes, name, dirty, bookId, formBookId, baseRevision]);
  const edit = (patch: Partial<BehaviorCode>, id = selected) => {
    setCodes(
      codes.map((code) => (code.id === id ? { ...code, ...patch } : code)),
    );
    setDirty(true);
  };
  const code = codes.find((item) => item.id === selected);
  const add = () => {
    const id = crypto.randomUUID();
    setCodes([
      ...codes,
      {
        id,
        code: "NEW_CODE",
        name: "New behavior",
        definition: "",
        inclusionCriteria: [],
        exclusionCriteria: [],
        examples: [],
        counterexamples: [],
        qualifyingEvidenceTypes: ["executed action"],
        enabled: true,
        archived: false,
        color: "#3b82f6",
      },
    ]);
    setSelected(id);
    setDirty(true);
  };
  const create = async () => {
    const result = await command.run(() =>
      clients.codebooks.create({
        name: "Study codebook",
        author: author || "Researcher",
      }),
    );
    if (result) {
      setBookOptions((previous) => [
        ...previous.filter((book) => book.id !== result.codebook.id),
        result.codebook,
      ]);
      setBookId(result.codebook.id);
      void booksPage.refresh();
    }
  };
  const save = async () => {
    if (!current.data || formBookId !== bookId || !baseRevisionId) return;
    const result = await command.run(
      () =>
        clients.codebooks.revise(bookId, {
          expectedRevisionId: baseRevisionId,
          name,
          codes: codes.map((item) => ({
            ...item,
            ...Object.fromEntries(
              (
                [
                  "inclusionCriteria",
                  "exclusionCriteria",
                  "examples",
                  "counterexamples",
                  "qualifyingEvidenceTypes",
                ] as const
              ).map((key) => [
                key,
                item[key].map((value) => value.trim()).filter(Boolean),
              ]),
            ),
          })),
          author,
        }),
      "New immutable codebook revision saved. Existing analyses keep their frozen definitions.",
    );
    if (result) {
      setDirty(false);
      localStorage.removeItem("sidechannel-codebook-" + bookId);
      void current.refresh();
      void booksPage.refresh();
    }
  };
  const duplicate = () => {
    if (!code) return;
    const copied = duplicateCode(code);
    setCodes([...codes, copied]);
    setSelected(copied.id);
    setDirty(true);
  };
  const reorder = (direction: number) => {
    const result = moveCode(codes, selected, direction);
    if (!result) return;
    setCodes(result);
    setDirty(true);
  };
  const selectedBook = current.data?.codebook;
  const readOnly = Boolean(selectedBook?.archivedAt);
  const changeShowArchived = (checked: boolean) => {
    setShowArchived(checked);
    setBookOptions([]);
    if (!checked && selectedBook?.archivedAt) setBookId("");
  };
  const setArchived = async (archive: boolean) => {
    if (!current.data || formBookId !== bookId || !baseRevisionId) return;
    if (!author.trim()) return;
    if (archive && dirty) return;
    if (
      archive &&
      !window.confirm(
        `Archive "${name}"? Existing analyses are unaffected and keep their frozen definitions, but this codebook cannot be used for new analyses until it is restored.`,
      )
    )
      return;
    const result = await command.run(
      () =>
        (archive ? clients.codebooks.archive : clients.codebooks.restore)(bookId, {
          expectedRevisionId: baseRevisionId,
          author: author.trim(),
        }),
      archive
        ? "Codebook archived. Existing analyses keep their frozen definitions."
        : "Codebook restored. It can be used for new analyses.",
    );
    if (result) {
      setDirty(false);
      void current.refresh();
      void booksPage.refresh();
    }
  };
  const restoreRecovery = () => {
    if (!recovery) return;
    const localIds = new Set(recovery.codes.map((item) => item.id));
    setCodes([
      ...recovery.codes,
      ...(current.data?.revision.codes ?? []).filter(
        (item) => !localIds.has(item.id),
      ),
    ]);
    setName(recovery.name);
    setSelected(recovery.codes[0]?.id ?? "");
    setDirty(true);
    setRecovery(undefined);
  };
  const validation = validateCodebook(
    { name, author, codes, baseRevisionId },
    { dirty, baseLoaded: formBookId === bookId && !!baseRevisionId },
  );
  return {
    books: bookOptions,
    booksLoading: booksPage.loading,
    booksError: booksPage.error,
    booksRefresh: booksPage.refresh,
    hasMoreBooks: booksPage.hasMore,
    loadMoreBooks: () => booksPage.onChange(booksPage.page + 1),
    bookId,
    selectBook: setBookId,
    name,
    setName,
    author,
    setAuthor,
    changeAuthor: (value: string) => {
      setAuthor(value);
      localStorage.setItem(REVIEWER_STORAGE_KEY, value);
    },
    codes,
    selected,
    select: setSelected,
    code,
    dirty,
    add,
    duplicate,
    reorder,
    edit,
    recovery,
    restoreRecovery,
    validation,
    current: current.data,
    loading: current.loading,
    error: current.error,
    command,
    create,
    save,
    loadLatest: () => {
      command.clear();
      void current.refresh();
    },
    historyOpen,
    setHistoryOpen,
    revisions: revisions.data,
    revisionsLoading: revisions.loading,
    revisionsError: revisions.error,
    selectedBook,
    readOnly,
    showArchived,
    changeShowArchived,
    setArchived,
    historyRevision,
    selectRevision: setHistoryRevision,
    revisionsPage: {
      page: revisions.page,
      hasMore: revisions.hasMore,
      onChange: (next: number) => {
        revisions.onChange(next);
        setHistoryRevision(undefined);
      },
      back: () => {
        revisions.onChange(revisions.page - 1);
        setHistoryRevision(undefined);
      },
    },
  };
}


