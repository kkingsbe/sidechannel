import { Link } from "react-router-dom";
import { Button, Check, ErrorState, JsonView, Loading } from "../../components/ui";
import { useApi } from "../../lib/api";
import { useClients } from "../../lib/clients/context";
import type { HarnessEvent } from "@sidechannel/contracts/browser";
import { RecordedEventContent } from "./RecordedEventContent";

export function CanonicalEvent({
  eventId,
  runId,
  supplied,
  selected,
  onToggle,
  onAnnotate,
}: {
  eventId: string;
  runId: string;
  supplied?: HarnessEvent;
  selected: boolean;
  onToggle: () => void;
  onAnnotate: () => void;
}) {
  const clients = useClients();
  const source = useApi<HarnessEvent>(
    supplied ? null : clients.runs.paths.event(runId, eventId),
  );
  const event = supplied ?? source.data;
  return (
    <article className="analysis-event" id={`citation-${eventId}`}>
      <h4>{event?.type ? event.type.replaceAll("_", " ") : "Source event"}</h4>
      {event?.sequence != null && (
        <p className="helper">
          Sequence {event.sequence} - actor {event.agentId || "system"}
          {event.round != null ? `  -  round ${event.round}` : ""}
          {event.turn != null ? `  -  turn ${event.turn}` : ""}
        </p>
      )}
      {source.loading ? (
        <Loading />
      ) : source.error ? (
        <ErrorState error={source.error} retry={source.refresh} />
      ) : event?.id === eventId ? (
        <RecordedEventContent type={event.type} data={event.data} />
      ) : (
        <p className="helper">
          Recorded content unavailable. Open the exact source event to inspect
          it.
        </p>
      )}
      <div className="actions">
        <Check
          label={`Cite ${event?.type || "event"} ${event?.sequence ?? eventId}`}
          checked={selected}
          onChange={onToggle}
        />
        <Button variant="ghost" size="sm" onClick={onAnnotate}>
          Annotate this event
        </Button>
        <Link
          className="table-title"
          to={`/runs/${runId}?view=timeline&evidence=${encodeURIComponent(eventId)}`}
        >
          Exact source event
        </Link>
      </div>
      <small className="mono">{eventId}</small>
      {event?.id === eventId && (
        <JsonView value={event} title="Raw canonical payload" />
      )}
    </article>
  );
}
