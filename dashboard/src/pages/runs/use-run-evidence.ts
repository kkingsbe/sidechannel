import { useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useClients } from "../../lib/clients/context";
import { useResource, useResourceOffsetPage, useResourcePage } from "../../lib/clients/query";
import type { EvidenceKind } from "../../lib/clients/runs";
import type { EvidencePages, RunTab } from "../../lib/contracts";
import type { HarnessEvent } from "../../lib/types";

export interface RunFilters { actor: string; phase: string; type: string; from: string; to: string }
const EMPTY_FILTERS: RunFilters = { actor: "", phase: "", type: "", from: "", to: "" };

/** One registered evidence tab reads exactly its own transport slice. */
export type RunViewKind = "timeline" | "traces" | "board" | "artifacts" | "memory" | "reports" | "configuration" | "results";

export const useRunId = () => useParams().id;

/** Event page for the timeline/traces views; filters and pager are owned by the view. */
export function useRunEvents(kind: "timeline" | "traces") {
  const id = useRunId();
  const clients = useClients();
  const [filters, setFilters] = useState<RunFilters>(EMPTY_FILTERS);
  const [key, setKey] = useState(0);
  const resource = useResourcePage<HarnessEvent>(
    id ? `run:${id}:events:${kind}:${key}` : null,
    (cursor) =>
      clients.runs.events(id!, {
        limit: 50,
        after: cursor ?? undefined,
        ...(filters.actor ? { actor: filters.actor } : {}),
        ...(filters.phase ? { phase: filters.phase } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
      }),
    { interval: 4000 },
  );
  const setFilter = (name: keyof RunFilters, value: string) => {
    setFilters((previous) => ({ ...previous, [name]: value }));
    setKey((previous) => previous + 1);
  };
  const rows = resource.data;
  const traceEvents = kind === "traces" ? rows.filter((event) => /model|invocation|reason|trace/.test(event.type)) : rows;
  return { ...resource, filters, setFilter, traceEvents };
}

/** Offset evidence envelope + its typed payload for one of the four evidence views. */
export function useRunEvidence(kind: Exclude<RunTab, "timeline" | "traces">) {
  const id = useRunId();
  const clients = useClients();
  const payload = useRef<EvidencePages[RunTab]>(undefined);
  const page = useResourceOffsetPage<unknown>(
    id ? `run:${id}:evidence:${kind}` : null,
    async (offset) => {
      const next = await clients.runs.evidenceTab(id!, kind, { limit: 30, offset });
      payload.current = next;
      return { items: next.items, total: "total" in next ? next.total : 0, nextOffset: next.nextOffset ?? null };
    },
    { interval: 5000, pageSize: 30 },
  );
  return { ...page, payload: payload.current };
}

/** The URL-selected drawer record, read through the same client surface. */
export function useRunSelection(kind: RunViewKind, selected: string | null) {
  const id = useRunId();
  const clients = useClients();
  const eventResource = useResource<HarnessEvent>(
    id && selected && (kind === "timeline" || kind === "traces" || kind === "memory") ? `run:${id}:event:${selected}` : null,
    () => clients.runs.event(id!, selected!),
  );
  const decoded = selected
    ? kind === "artifacts"
      ? selected.replace("version-", "")
      : kind === "reports"
        ? selected.replace("agent-", "")
        : selected
    : null;
  const itemResource = useResource<unknown>(
    id && selected && (kind === "board" || kind === "artifacts" || kind === "reports") ? `run:${id}:item:${kind}:${selected}` : null,
    () => clients.runs.evidenceItem(id!, kind as EvidenceKind, decoded!),
  );
  return {
    event: eventResource.data,
    item: itemResource.data,
    loading: eventResource.loading || itemResource.loading,
    error: eventResource.error ?? itemResource.error,
  };
}

/** Route parameters for the detail shell; `view` falls back to the registry default. */
export function useRunRoute() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") || "timeline";
  const selected = params.get("evidence");
  const setTab = (view: string) =>
    setParams((previous) => {
      previous.set("view", view);
      previous.delete("evidence");
      previous.delete("seq");
      return previous;
    });
  const inspect = (key: string, sequence?: number) =>
    setParams((previous) => {
      previous.set("evidence", key);
      sequence ? previous.set("seq", String(sequence)) : previous.delete("seq");
      return previous;
    });
  const close = () =>
    setParams((previous) => {
      previous.delete("evidence");
      previous.delete("seq");
      return previous;
    });
  /** Switch to Model & traces focused on one invocation (main's openTraces). */
  const openTraces = (invocationId: string) =>
    setParams((previous) => {
      previous.set("view", "traces");
      previous.set("call", invocationId);
      previous.delete("evidence");
      previous.delete("seq");
      return previous;
    });
  return { params, tab, selected, setTab, inspect, close, openTraces };
}
