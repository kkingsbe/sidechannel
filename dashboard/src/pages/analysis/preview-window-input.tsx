import { Loading, JsonView, Notice } from "../../components/ui";
import { usePageRequest } from "../../lib/api";
import { useClients } from "../../lib/clients/context";

export function PreviewWindowInput({
  token,
  windowId,
}: {
  token?: string;
  windowId: string;
}) {
  const clients = useClients();
  const state = usePageRequest<{ state: string }>(
    token ? () => clients.analyses.previewWindow(token, windowId) : null,
  );
  return state.loading ? (
    <Loading />
  ) : state.data ? (
    <JsonView value={state.data.state} title="Exact serialized evidence" />
  ) : (
    <Notice kind="warning">
      Exact preview evidence is unavailable from this API version. The window
      boundaries and budgeting are shown above. {state.error?.message}
    </Notice>
  );
}
