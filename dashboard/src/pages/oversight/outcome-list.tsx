import { Plus } from "lucide-react";
import { Button, Card, CardHeading } from "../../components/ui";
import type { OutcomeDefinition } from "@sidechannel/contracts/browser";

/** Run-level outcome definitions with stable archive-preserving IDs. */
export function OutcomeList({
  outcomes,
  selected,
  onSelect,
  onAdd,
}: {
  outcomes: OutcomeDefinition[];
  selected: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <Card>
      <CardHeading
        title="Run-level outcomes"
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Add outcome definition"
            onClick={onAdd}
          >
            <Plus size={16} />
          </Button>
        }
      />
      {outcomes.map((item) => (
        <button
          key={item.id}
          className={"list-button " + (selected === item.id ? "selected" : "")}
          onClick={() => onSelect(item.id)}
        >
          <div>
            <strong>{item.name}</strong>
            <small>{item.archived ? "Archived" : "Active definition"}</small>
          </div>
        </button>
      ))}
    </Card>
  );
}
