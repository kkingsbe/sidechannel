import { Archive } from "lucide-react";
import {
  Button,
  Card,
  CardHeading,
  Field,
  Input,
  Textarea,
} from "../../components/ui";
import type { OutcomeDefinition } from "@sidechannel/contracts/browser";

/** One outcome definition; archive/restore keeps stable IDs for historical comparisons. */
export function OutcomeEditor({
  outcome,
  onEdit,
}: {
  outcome: OutcomeDefinition;
  onEdit: (patch: Partial<OutcomeDefinition>) => void;
}) {
  return (
    <Card>
      <CardHeading
        title={outcome.name}
        description={"Stable ID · " + outcome.id}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit({ archived: !outcome.archived })}
          >
            <Archive size={14} />
            {outcome.archived ? "Restore" : "Archive"}
          </Button>
        }
      />
      <div className="card-body form-grid">
        <Field required label="Display name" className="full">
          <Input
            value={outcome.name}
            onChange={(e) => onEdit({ name: e.target.value })}
          />
        </Field>
        {(
          [
            "definition",
            "qualifyingCriteria",
            "presentGuidance",
            "absentGuidance",
            "uncertainGuidance",
            "examples",
            "exclusions",
          ] as const
        ).map((key) => (
          <Field
            key={key}
            required={key === "definition"}
            className="full"
            label={
              {
                definition: "Definition",
                qualifyingCriteria: "Qualifying criteria",
                presentGuidance: "Present guidance",
                absentGuidance: "Absent guidance",
                uncertainGuidance: "Uncertain guidance",
                examples: "Examples",
                exclusions: "Exclusions",
              }[key]
            }
          >
            <Textarea
              rows={7}
              value={outcome[key]}
              onChange={(e) => onEdit({ [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
    </Card>
  );
}
