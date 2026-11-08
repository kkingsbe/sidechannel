import { useEffect } from "react";
import { ChevronRight, Copy, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, ErrorState, JsonView, Loading } from "../../components/ui";
import { useApi } from "../../lib/api";
import { useClients } from "../../lib/clients/context";
import type { HarnessEvent } from "@sidechannel/contracts/browser";
import { RecordedEventContent } from "./RecordedEventContent";
import "./evidence-event.css";

/** Context events are accounting; everything else is something an actor did. */
export function eventKind(type: string | undefined): "context" | "action" {
  return type === "context_accounted" ||
    type === "model_requested" ||
    type === "model_usage"
    ? "context"
    : "action";
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;

const typeLabel = (type: string | undefined) => {
  if (!type) return "Source event";
  const spaced = type.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
const labelFor = (type: string | undefined) =>
  type === "model_response" ? "Model response" : typeLabel(type);

function compact(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return oneLine(value);
  try {
    return oneLine(JSON.stringify(value) ?? "");
  } catch {
    return "";
  }
}

/** One line of what the event says, for the collapsed row. */
export function summarizeForRow(event: HarnessEvent): string {
  const data = record(event.data);
  const type = event.type;
  if (type === "context_accounted") {
    const measured = num(data.measured);
    const limit = num(data.limit);
    const unit = str(data.unit) ?? "tokens";
    const model = str(record(data.capacity).modelId);
    if (measured != null) {
      const head =
        limit != null
          ? `${measured.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} ${unit}`
          : `${measured.toLocaleString("en-US")} ${unit}`;
      return model ? `${head} · ${model}` : head;
    }
  }
  if (type === "model_requested") {
    const count = Array.isArray(data.messages) ? data.messages.length : 0;
    return `System prompt and ${count} message${count === 1 ? "" : "s"} · repeated context`;
  }
  if (type === "model_response") {
    const text = str(data.text) ?? str(data.content);
    if (text) return `“${clip(oneLine(text), 120)}”`;
    const calls = Array.isArray(data.toolCalls) ? data.toolCalls : [];
    const name = str(record(calls[0]).name);
    if (name) return `Proposed ${name}`;
  }
  if (type.startsWith("tool_")) {
    const call = record(data.call);
    const name = str(call.name) ?? str(data.name) ?? event.toolCallId ?? "tool";
    const detail =
      type === "tool_requested"
        ? compact(call.arguments ?? call.args)
        : type === "tool_admitted"
          ? "admitted"
          : [str(data.disposition), compact(data.result ?? data.reason ?? data.error)]
              .filter(Boolean)
              .join(" · ");
    return clip(detail ? `${name} · ${detail}` : name, 140);
  }
  for (const [key, value] of Object.entries(data)) {
    if (["string", "number", "boolean"].includes(typeof value))
      return clip(`${key.replaceAll("_", " ")}: ${String(value)}`, 140);
  }
  return "";
}

export function CanonicalEvent({
  eventId,
  runId,
  supplied,
  selected,
  onToggle,
  open,
  onOpenChange,
  onJudgeOnly,
  onLoaded,
}: {
  eventId: string;
  runId: string;
  supplied?: HarnessEvent;
  selected: boolean;
  onToggle: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJudgeOnly: () => void;
  /** Called once a lazily fetched event arrives, so the parent can count and label it. */
  onLoaded?: (event: HarnessEvent) => void;
}) {
  const clients = useClients();
  const source = useApi<HarnessEvent>(
    supplied ? null : clients.runs.paths.event(runId, eventId),
  );
  const event = supplied ?? source.data;
  const ready = event?.id === eventId ? event : undefined;
  const fetched = !supplied && ready ? ready : undefined;
  useEffect(() => {
    if (fetched) onLoaded?.(fetched);
    // Report each fetched event once; the callback identity changes every parent render.
  }, [fetched]);
  const actor = ready?.agentId || "system";
  const label = labelFor(ready?.type);
  const shortId = eventId.length > 8 ? `${eventId.slice(0, 8)}…` : eventId;
  const summary = ready ? summarizeForRow(ready) : "";
  return (
    <article
      className={`ev-row${selected ? " cited" : ""}`}
      id={`citation-${eventId}`}
    >
      <div className="ev-head">
        <input
          type="checkbox"
          className="ev-cite"
          aria-label={`Cite event ${ready?.sequence ?? eventId}, ${label}`}
          checked={selected}
          onChange={onToggle}
        />
        <button
          type="button"
          className="ev-toggle"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          <span className="ev-seq">{ready?.sequence ?? ""}</span>
          <span className="ev-titleline">
            <span
              className={`ev-type ${eventKind(ready?.type) === "context" ? "context" : ""}`}
            >
              {label}
            </span>
            <span className="ev-actor ev-ell">{actor}</span>
          </span>
          <span className="ev-meta">
            {ready?.round != null || ready?.turn != null
              ? `r${ready?.round ?? "?"} · t${ready?.turn ?? "?"}`
              : ""}
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={`ev-chevron${open ? " open" : ""}`}
            />
          </span>
          {summary && <span className="ev-summary ev-ell">{summary}</span>}
        </button>
      </div>
      {open && (
        <div className="ev-body">
          {source.loading ? (
            <Loading />
          ) : source.error ? (
            <ErrorState error={source.error} retry={source.refresh} />
          ) : ready ? (
            <RecordedEventContent
              type={ready.type}
              data={ready.data}
              actor={actor}
            />
          ) : (
            <p className="ev-note">
              Recorded content unavailable. Open the event in the run timeline
              to inspect it.
            </p>
          )}
          <div className="ev-actions">
            <Button variant="ghost" size="sm" onClick={onJudgeOnly}>
              Judge this event only
            </Button>
            <Link
              to={`/runs/${runId}?view=timeline&evidence=${encodeURIComponent(eventId)}`}
            >
              Open in run timeline
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
            {ready && <JsonView value={ready} title="Raw payload" />}
            <span className="ev-id">
              <span title={eventId}>{shortId}</span>
              <button
                type="button"
                className="ev-copy"
                aria-label={`Copy event ID ${eventId}`}
                onClick={() => void navigator.clipboard?.writeText(eventId)}
              >
                <Copy size={13} aria-hidden="true" />
              </button>
            </span>
          </div>
        </div>
      )}
    </article>
  );
}
