import { useEffect, useState, type ReactElement } from "react";
import { History, Save } from "lucide-react";
import {
  Button,
  Card,
  CardHeading,
  Drawer,
  ErrorState,
  Field,
  JsonView,
  Loading,
  Notice,
  Pager,
  Textarea,
} from "../../components/ui";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import type {
  MonitorDefinition,
  OutcomeDefinition,
} from "@sidechannel/contracts/browser";
import { when } from "../../lib/utils";
import { OutcomeEditor } from "./outcome-editor";
import { OutcomeList } from "./outcome-list";
import {
  useCurrentDefinition,
  useMonitorDefinitionHistory,
} from "./use-monitor-definition";

/** Questions & outcome definitions: the only tab that loads and saves the definition. */
export function DefinitionsTab(): ReactElement {
  const clients = useClients();
  const current = useCurrentDefinition();
  const [draft, setDraft] = useState<MonitorDefinition>();
  const [selected, setSelected] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history = useMonitorDefinitionHistory(showHistory);
  const [historical, setHistorical] = useState<MonitorDefinition>();
  const command = useCommand();
  useEffect(() => {
    if (!current.definition || dirty) return;
    const saved = localStorage.getItem("sidechannel-monitor-definition");
    if (saved) {
      try {
        const recovery = JSON.parse(saved) as MonitorDefinition;
        if (recovery.revision === current.definition.revision) {
          setDraft(recovery);
          setSelected(recovery.outcomes[0]?.id || "");
          setDirty(true);
          return;
        }
      } catch {
        /* Invalid local copy. */
      }
    }
    setDraft(structuredClone(current.definition));
    setSelected(current.definition.outcomes[0]?.id || "");
  }, [current.definition]);
  useEffect(() => {
    if (dirty && draft)
      localStorage.setItem(
        "sidechannel-monitor-definition",
        JSON.stringify(draft),
      );
  }, [draft, dirty]);
  if (current.loading || (!draft && !current.error)) return <Loading />;
  if (!draft)
    return <ErrorState error={current.error} retry={current.refresh} />;
  const outcome = draft.outcomes.find((o) => o.id === selected);
  const edit = (patch: Partial<OutcomeDefinition>) => {
    setDraft({
      ...draft,
      outcomes: draft.outcomes.map((o) =>
        o.id === selected ? { ...o, ...patch } : o,
      ),
    });
    setDirty(true);
  };
  const save = async () => {
    const result = await command.run(
      () =>
        clients.monitor.saveDefinition({
          ...draft,
          expectedRevision: draft.revision,
        }),
      "Immutable monitor definition revision saved. Existing evaluation snapshots are unchanged.",
    );
    if (result) {
      setDraft(result);
      setDirty(false);
      localStorage.removeItem("sidechannel-monitor-definition");
      void current.refresh();
      if (showHistory) void history.refresh();
    }
  };
  return (
    <>
      <Notice>
        These definitions govern run-level oversight and human reference
        outcomes. They are separate from Jev behavior codes. Archive stable
        outcome IDs to preserve historical comparisons.
      </Notice>
      {command.error && (
        <Notice kind="error">
          {command.error.message}
          <p>
            Unsaved definitions are retained. A revision conflict requires
            reloading and reconciling; existing evaluations keep their frozen
            snapshot.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (
                window.confirm(
                  "Reload current server definitions? Unsaved edits are retained in the local recovery copy.",
                )
              ) {
                setDirty(false);
                localStorage.removeItem("sidechannel-monitor-definition");
                void current.refresh();
              }
            }}
          >
            Reload latest definitions
          </Button>
        </Notice>
      )}
      {command.message && <Notice kind="success">{command.message}</Notice>}
      <Card className="form-section">
        <CardHeading
          title="Monitor evaluation questions"
          description={`Editing revision ${draft.revision} Â· ${dirty ? "Unsaved edits" : "Saved"}`}
          actions={
            <>
              <Button variant="secondary" onClick={() => setShowHistory(true)}>
                <History size={14} />
                History
              </Button>
              <Button
                onClick={save}
                disabled={
                  command.busy ||
                  !dirty ||
                  !draft.questions.trim() ||
                  draft.outcomes.some(
                    (o) =>
                      !o.archived && (!o.definition.trim() || !o.name.trim()),
                  )
                }
              >
                <Save size={14} />
                Save revision
              </Button>
            </>
          }
        />
        <div className="card-body">
          <p className="helper">
            {command.busy
              ? "Saving revision - "
              : !dirty
                ? "Edit definitions to enable saving a new revision."
                : !draft.questions.trim() ||
                    draft.outcomes.some(
                      (o) =>
                        !o.archived && (!o.name.trim() || !o.definition.trim()),
                    )
                  ? "Before saving: enter evaluation questions and a name and definition for every active outcome."
                  : "Ready to save a new immutable revision."}
          </p>
          <Field
            required
            label="Evaluation questions / instructions"
            hint="The complete wording is frozen at launch and shared across the four isolated views."
          >
            <Textarea
              rows={6}
              value={draft.questions}
              onChange={(e) => {
                setDraft({ ...draft, questions: e.target.value });
                setDirty(true);
              }}
            />
          </Field>
        </div>
      </Card>
      <div className="split">
        <OutcomeList
          outcomes={draft.outcomes}
          selected={selected}
          onSelect={setSelected}
          onAdd={() => {
            const id = crypto.randomUUID();
            setDraft({
              ...draft,
              outcomes: [
                ...draft.outcomes,
                {
                  id,
                  name: "New outcome",
                  definition: "",
                  qualifyingCriteria: "",
                  presentGuidance: "",
                  absentGuidance: "",
                  uncertainGuidance: "",
                  examples: "",
                  exclusions: "",
                  archived: false,
                },
              ],
            });
            setSelected(id);
            setDirty(true);
          }}
        />
        {outcome && <OutcomeEditor outcome={outcome} onEdit={edit} />}
      </div>
      <Drawer
        open={showHistory}
        onOpenChange={setShowHistory}
        title="Monitor definition history"
      >
        {history.items.map((item) => (
          <button
            className="list-button"
            key={item.id}
            onClick={() => setHistorical(item)}
          >
            <div>
              <strong>Revision {item.revision}</strong>
              <small>
                {when(item.createdAt)} Â·{" "}
                {item.outcomes.filter((o) => !o.archived).length} active
                outcomes
              </small>
            </div>
          </button>
        ))}
        {history.loading && <Loading />}
        {history.error && (
          <ErrorState error={history.error} retry={history.refresh} />
        )}
        <Pager
          page={history.page}
          hasMore={history.hasMore}
          onChange={history.onChange}
        />
        {historical && (
          <JsonView
            value={historical}
            title={"Immutable revision " + historical.revision}
          />
        )}
      </Drawer>
    </>
  );
}


