import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { RunProgress } from "../../lib/contracts";

/** Polling is isolated here: the only place that reports run freshness. */
export function useRunProgress(id: string | undefined) {
  const clients = useClients();
  const resource = useResource<RunProgress>(id ? `run:${id}:progress` : null, () => clients.runs.progress(id!), { interval: 3500 });
  return { progress: resource.data, updatedAt: resource.updatedAt, stale: !!resource.error, error: resource.error, refresh: resource.refresh };
}
