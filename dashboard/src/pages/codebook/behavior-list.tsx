import { Plus } from "lucide-react";
import { Badge, Button, Card, CardHeading } from "../../components/ui";
import type { useCodebookDraft } from "./use-codebook-draft";

/** Active and archived behavior definitions in revision order. */
export function BehaviorList({
  draft,
}: {
  draft: ReturnType<typeof useCodebookDraft>;
}) {
  return (
    <Card>
      <CardHeading
        title="Behavior codes"
        description={`${draft.codes.filter((c) => c.enabled && !c.archived).length} enabled · revision ${draft.current?.codebook.revision ?? "—"}`}
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Add behavior code"
            onClick={draft.add}
          >
            <Plus size={17} />
          </Button>
        }
      />
      {draft.codes.map((item) => (
        <button
          className={
            "list-button " + (draft.selected === item.id ? "selected" : "")
          }
          key={item.id}
          onClick={() => draft.select(item.id)}
        >
          <span className="color-dot" style={{ background: item.color }} />
          <div>
            <strong>{item.code}</strong>
            <small>{item.name}</small>
          </div>
          <Badge>
            {item.archived ? "Archived" : item.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </button>
      ))}
      <div className="card-body" style={{ paddingTop: 18 }}>
        <Button variant="secondary" onClick={draft.add} size="sm">
          <Plus size={13} />
          New behavior
        </Button>
      </div>
    </Card>
  );
}
