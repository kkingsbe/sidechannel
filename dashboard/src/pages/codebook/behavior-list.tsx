import { Plus } from "lucide-react";
import { Button, Card, CardHeading, Empty, Field, Input } from "../../components/ui";
import { when } from "../../lib/utils";
import { CodebookArchive } from "./codebook-selector";
import type { useCodebookDraft } from "./use-codebook-draft";

/** Behaviour definitions in revision order: a name, one line of definition and an enabled switch. */
export function BehaviorList({
  draft,
}: {
  draft: ReturnType<typeof useCodebookDraft>;
}) {
  const revision = draft.current?.revision;
  return (
    <Card>
      <CardHeading
        title="Behaviours"
        count={draft.codes.length}
        actions={
          <Button variant="secondary" size="sm" onClick={draft.add} disabled={draft.readOnly}>
            <Plus size={13} />
            New behaviour
          </Button>
        }
      />
      <div className="list-name">
        <Field
          label="Codebook name"
          required
          error={draft.dirty ? draft.validation.nameError : undefined}
        >
          <Input value={draft.name} onChange={(e) => draft.setName(e.target.value)} />
        </Field>
      </div>
      {draft.codes.length ? (
        draft.codes.map((item) => (
          <div
            key={item.id}
            className={
              "behaviour-row" +
              (draft.selected === item.id ? " active" : "") +
              (item.archived ? " archived" : "")
            }
          >
            <button
              type="button"
              className="behaviour-pick"
              aria-pressed={draft.selected === item.id}
              onClick={() => draft.select(item.id)}
            >
              <b>{item.code}{item.archived && " (archived)"}</b>
              <span>{item.definition.trim() || item.name}</span>
            </button>
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={`${item.code} enabled in new analyses`}
                checked={item.enabled && !item.archived}
                disabled={item.archived || draft.readOnly}
                onChange={(e) =>
                  draft.edit({ enabled: e.target.checked }, item.id)
                }
              />
              <i />
            </label>
          </div>
        ))
      ) : (
        <Empty
          title="No behaviours yet"
          description="Add the first behaviour Jev should screen for."
        >
          <Button size="sm" onClick={draft.add} disabled={draft.readOnly}>
            <Plus size={13} />
            New behaviour
          </Button>
        </Empty>
      )}
      <div className="card-foot">
        <span>
          {revision
            ? `Revision ${revision.revision} · saved ${when(revision.createdAt)} by ${revision.author}`
            : "No saved revision"}
        </span>
        <label className="check" style={{ fontSize: 13, marginLeft: "auto" }}>
          <input
            type="checkbox"
            checked={draft.showArchived}
            onChange={(e) => draft.changeShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>
      <div className="card-foot">
        <CodebookArchive draft={draft} />
      </div>
    </Card>
  );
}
