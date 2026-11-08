import { useClients } from "../../lib/clients/context";
import { useResource, useResourcePage } from "../../lib/clients/query";

/** Definition revisions, newest first; `open` keeps a closed drawer from fetching. */
export function useMonitorDefinitionHistory(open = true) {
  const clients = useClients();
  const page = useResourcePage(
    open ? "oversight:definition-history" : null,
    (cursor) =>
      clients.monitor.history({ limit: 25, after: cursor ?? undefined }),
  );
  return {
    items: page.data,
    page: page.page,
    hasMore: page.hasMore,
    onChange: page.onChange,
    loading: page.loading,
    error: page.error,
    refresh: page.refresh,
  };
}

/** The latest immutable definition revision. */
export function useCurrentDefinition() {
  const clients = useClients();
  const resource = useResource("oversight:current-definition", () =>
    clients.monitor.definition(),
  );
  return {
    definition: resource.data,
    loading: resource.loading,
    error: resource.error,
    refresh: resource.refresh,
  };
}
