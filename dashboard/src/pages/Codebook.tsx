import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Archive,
  Copy,
  History,
  Plus,
  Save,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  Check,
  Drawer,
  Empty,
  ErrorState,
  Field,
  Input,
  Loading,
  Notice,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";
import { api, post, useApi, useMutation } from "../lib/api";
import { list, when } from "../lib/utils";
import type {
  BehaviorCode,
  Codebook,
  CodebookRevision,
  Page,
} from "../lib/analysis-types";
export default function CodebookPage() {
  const books = useApi<Page<Codebook>>("/codebooks");
  const [bookId, setBookId] = useState("");
  const current = useApi<{ codebook: Codebook; revision: CodebookRevision }>(
    bookId ? "/codebooks/" + bookId : null,
  );
  const [codes, setCodes] = useState<BehaviorCode[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [author, setAuthor] = useState(
    () => localStorage.getItem("sidechannel-reviewer") || "",
  );
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState(false);
  const revisions = useApi<Page<CodebookRevision>>(
    history && bookId ? "/codebooks/" + bookId + "/revisions" : null,
  );
  const [historyRevision, setHistoryRevision] = useState<CodebookRevision>();
  const mutation = useMutation();
  useEffect(() => {
    if (!bookId && books.data?.items[0]) setBookId(books.data.items[0].id);
  }, [books.data, bookId]);
  useEffect(() => {
    if (!current.data) return;
    const key = "sidechannel-codebook-" + current.data.codebook.id;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const recovered = JSON.parse(saved);
        if (recovered.baseRevision === current.data.codebook.revision) {
          setCodes(recovered.codes);
          setName(recovered.name);
          setSelected(recovered.codes[0]?.id || "");
          setDirty(true);
          return;
        }
      } catch {
        /* Invalid recovery copy. */
      }
    }
    setCodes(structuredClone(current.data.revision.codes));
    setName(current.data.codebook.name);
    setSelected(current.data.revision.codes[0]?.id || "");
    setDirty(false);
  }, [current.data]);
  useEffect(() => {
    if (dirty && current.data)
      localStorage.setItem(
        "sidechannel-codebook-" + bookId,
        JSON.stringify({
          codes,
          name,
          baseRevision: current.data.codebook.revision,
        }),
      );
  }, [codes, name, dirty, bookId, current.data]);
  const edit = (patch: Partial<BehaviorCode>) => {
    setCodes(
      codes.map((code) =>
        code.id === selected ? { ...code, ...patch } : code,
      ),
    );
    setDirty(true);
  };
  const code = codes.find((code) => code.id === selected);
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
    const result = await mutation.run(() =>
      post<{ codebook: Codebook; revision: CodebookRevision }>("/codebooks", {
        name: "Study codebook",
        author: author || "Researcher",
      }),
    );
    if (result) {
      setBookId(result.codebook.id);
      void books.refresh();
    }
  };
  const save = async () => {
    if (!current.data) return;
    const result = await mutation.run(
      () =>
        api<{ codebook: Codebook; revision: CodebookRevision }>(
          "/codebooks/" + bookId,
          {
            method: "PATCH",
            body: JSON.stringify({
              expectedRevisionId: current.data!.revision.id,
              name,
              codes,
              author,
            }),
          },
        ),
      "New immutable codebook revision saved. Existing analyses keep their frozen definitions.",
    );
    if (result) {
      setDirty(false);
      localStorage.removeItem("sidechannel-codebook-" + bookId);
      void current.refresh();
      void books.refresh();
    }
  };
  const duplicate = () => {
    if (!code) return;
    const id = crypto.randomUUID();
    setCodes([
      ...codes,
      {
        ...structuredClone(code),
        id,
        code: code.code + "_COPY",
        name: code.name + " copy",
      },
    ]);
    setSelected(id);
    setDirty(true);
  };
  const reorder = (direction: number) => {
    const index = codes.findIndex((c) => c.id === selected),
      next = index + direction;
    if (next < 0 || next >= codes.length) return;
    const result = [...codes];
    [result[index], result[next]] = [result[next], result[index]];
    setCodes(result);
    setDirty(true);
  };
  const duplicateNames = codes
    .filter((c) => !c.archived)
    .some((c, i, arr) => arr.findIndex((other) => other.code === c.code) !== i);
  const invalid =
    codes.some(
      (c) =>
        !c.archived &&
        (!c.definition.trim() || !c.code.trim() || !c.name.trim()),
    ) || duplicateNames;
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
              onClick={() => setHistory(true)}
              disabled={!bookId}
            >
              <History size={15} />
              Revision history
            </Button>
            <Button
              onClick={save}
              disabled={mutation.busy || !dirty || invalid || !author.trim()}
            >
              <Save size={15} />
              Save revision
            </Button>
          </>
        }
      />
      {mutation.error && (
        <Notice kind="error">
          {mutation.error.message}
          {"status" in mutation.error && mutation.error.status === 409 && (
            <p>
              Another researcher saved a newer revision. Your edits are retained
              locally. Reload the latest revision, then reconcile your changes
              before saving.
            </p>
          )}
        </Notice>
      )}
      {mutation.message && <Notice kind="success">{mutation.message}</Notice>}
      {dirty && (
        <Notice>
          Unsaved codebook changes are kept in this browser. Saving creates a
          revision for future analyses only.
        </Notice>
      )}
      {duplicateNames && (
        <Notice kind="error">
          Display codes must be unique among active definitions.
        </Notice>
      )}
      {books.loading ? (
        <Loading />
      ) : books.error ? (
        <ErrorState error={books.error} retry={books.refresh} />
      ) : !books.data?.items.length ? (
        <Card>
          <Empty
            title="Create the study codebook"
            description="Start with the editable tentative behavior definitions, then refine them through pilots."
          >
            <Button onClick={create} disabled={mutation.busy}>
              <Plus size={14} />
              Create codebook
            </Button>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="form-grid three" style={{ marginBottom: 20 }}>
            <Field label="Codebook">
              <Select
                value={bookId}
                onChange={(e) => {
                  if (
                    dirty &&
                    !window.confirm(
                      "Switch codebook? Your unsaved changes are retained in this browser.",
                    )
                  )
                    return;
                  setBookId(e.target.value);
                }}
              >
                {books.data.items.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name} · r{book.revision}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Codebook name">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
            <Field
              label="Revision author"
              hint="Claimed identity in this open workspace, not an authenticated account."
            >
              <Input
                value={author}
                onChange={(e) => {
                  setAuthor(e.target.value);
                  localStorage.setItem("sidechannel-reviewer", e.target.value);
                }}
              />
            </Field>
          </div>
          {current.loading ? (
            <Loading />
          ) : current.error ? (
            <ErrorState error={current.error} retry={current.refresh} />
          ) : (
            <div className="split">
              <Card>
                <CardHeading
                  title="Behavior codes"
                  description={`${codes.filter((c) => c.enabled && !c.archived).length} enabled · revision ${current.data?.codebook.revision ?? "—"}`}
                  actions={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Add behavior code"
                      onClick={add}
                    >
                      <Plus size={17} />
                    </Button>
                  }
                />
                {codes.map((item) => (
                  <button
                    className={
                      "list-button " + (selected === item.id ? "selected" : "")
                    }
                    key={item.id}
                    onClick={() => setSelected(item.id)}
                  >
                    <span
                      className="color-dot"
                      style={{ background: item.color }}
                    />
                    <div>
                      <strong>{item.code}</strong>
                      <small>{item.name}</small>
                    </div>
                    <Badge>
                      {item.archived
                        ? "Archived"
                        : item.enabled
                          ? "Enabled"
                          : "Disabled"}
                    </Badge>
                  </button>
                ))}
                <div className="card-body" style={{ paddingTop: 18 }}>
                  <Button variant="secondary" onClick={add} size="sm">
                    <Plus size={13} />
                    New behavior
                  </Button>
                </div>
              </Card>
              {code ? (
                <Card>
                  <CardHeading
                    title={code.name}
                    description={`Stable internal ID · ${code.id}`}
                    actions={
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Move code up"
                          onClick={() => reorder(-1)}
                          disabled={codes[0]?.id === selected}
                        >
                          <ArrowUp size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Move code down"
                          onClick={() => reorder(1)}
                          disabled={codes.at(-1)?.id === selected}
                        >
                          <ArrowDown size={15} />
                        </Button>
                      </>
                    }
                  />
                  <div className="card-body form-grid">
                    <Field
                      label="Display code"
                      error={
                        codes.some(
                          (c) =>
                            c.id !== code.id &&
                            !c.archived &&
                            c.code === code.code,
                        )
                          ? "This display code is already used."
                          : undefined
                      }
                    >
                      <Input
                        value={code.code}
                        onChange={(e) => edit({ code: e.target.value })}
                      />
                    </Field>
                    <Field label="Display name">
                      <Input
                        value={code.name}
                        onChange={(e) => edit({ name: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="Definition"
                      className="full"
                      hint="Required. Explain what this behavior means in this study."
                    >
                      <Textarea
                        rows={4}
                        value={code.definition}
                        onChange={(e) => edit({ definition: e.target.value })}
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
                      <Field
                        key={key}
                        label={
                          {
                            inclusionCriteria: "Inclusion criteria",
                            exclusionCriteria: "Exclusion criteria",
                            examples: "Examples",
                            counterexamples: "Counterexamples",
                            qualifyingEvidenceTypes:
                              "Qualifying evidence / action types",
                          }[key]
                        }
                        hint="One item per line."
                      >
                        <Textarea
                          value={code[key].join("\n")}
                          onChange={(e) =>
                            edit({ [key]: list(e.target.value) })
                          }
                        />
                      </Field>
                    ))}
                    <Field
                      label="Chart color"
                      hint="Codes are always identified by text as well as color."
                    >
                      <Input
                        type="color"
                        value={code.color}
                        onChange={(e) => edit({ color: e.target.value })}
                      />
                    </Field>
                    <div className="full actions">
                      <Check
                        label="Enabled in new analyses"
                        checked={code.enabled && !code.archived}
                        disabled={code.archived}
                        onChange={(e) => edit({ enabled: e.target.checked })}
                      />
                      <Button variant="secondary" size="sm" onClick={duplicate}>
                        <Copy size={13} />
                        Duplicate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          edit({
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
                      Archiving preserves historical analyses and reviews. A
                      behavior label alone does not establish a violation or
                      misconduct.
                    </Notice>
                  </div>
                </Card>
              ) : (
                <Empty title="Select a behavior definition" />
              )}
            </div>
          )}
        </>
      )}
      <Drawer
        open={history}
        onOpenChange={setHistory}
        title="Codebook revision history"
        description="Immutable definitions used by past and future analyses."
      >
        {revisions.loading ? (
          <Loading />
        ) : revisions.error ? (
          <ErrorState error={revisions.error} retry={revisions.refresh} />
        ) : (
          revisions.data?.items.map((revision) => (
            <button
              key={revision.id}
              className="list-button"
              onClick={() => setHistoryRevision(revision)}
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
        {historyRevision && (
          <div style={{ marginTop: 24 }}>
            <h3>Revision {historyRevision.revision}</h3>
            {historyRevision.codes.map((code) => (
              <div style={{ marginTop: 14 }} key={code.id}>
                <strong>
                  {code.code} · {code.name}
                </strong>
                <p className="helper">{code.definition}</p>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </>
  );
}
