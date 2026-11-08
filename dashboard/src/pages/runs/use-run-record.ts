import { useNavigate } from "react-router-dom";
import { ACTIVE_RUN_STATUSES } from "@sidechannel/contracts/browser";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import { mergeProgress, type RunProgress } from "../../lib/contracts";
import type { Run } from "../../lib/types";

/**
 * The run record, live progress merge and the two record-level commands.
 * Polling lives only in the progress resource (3500 ms, same as before).
 */
export function useRunRecord(id: string | undefined) {
  const clients = useClients();
  const navigate = useNavigate();
  const command = useCommand();
  const run = useResource<Run>(id ? `run:${id}` : null, () => clients.runs.get(id!));
  const progress = useResource<RunProgress>(id ? `run:${id}:progress` : null, () => clients.runs.progress(id!), { interval: 3500 });
  const data = run.data ? mergeProgress(run.data, progress.data) : undefined;
  const active = !!data && ACTIVE_RUN_STATUSES.includes(data.status);
  const cancel = async () => {
    if (
      !window.confirm(
        "Request cancellation? The worker will stop admitting new work and retain recorded evidence. An in-flight request may finish first.",
      )
    )
      return;
    await command.run(
      () => clients.runs.cancel(id!),
      "Cancellation requested. Waiting for the worker to reach a safe boundary.",
    );
    void progress.refresh();
  };
  const duplicate = async () => {
    const result = await command.run(() => clients.runs.duplicate(id!));
    if (result) navigate("/experiments?draft=" + result.id);
  };
  return { run, progress, data, command, active, cancel, duplicate };
}

/** A single run record read, for registry views that only need the frozen document. */
export function useRunRecordOnly(id: string | undefined) {
  const clients = useClients();
  return useResource<Run>(id ? `run:${id}` : null, () => clients.runs.get(id!));
}
