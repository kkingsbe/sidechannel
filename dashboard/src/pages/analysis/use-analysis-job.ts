import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { AnalysisJob } from "../../lib/analysis-types";
import type { Run } from "../../lib/types";

/** Frozen analysis job, its source run and the cancel/retry commands. */
export function useAnalysisJob(id: string | undefined) {
  const clients = useClients();
  const job = useResource(
    id ? `analysis:${id}` : null,
    () => clients.analyses.job(id!),
    { interval: 4000 },
  );
  const sourceRun = useResource(
    job.data ? `analysis:${id}:source` : null,
    () => clients.runs.get(job.data!.runId),
  );
  const command = useCommand();
  const cancel = async () => {
    if (!job.data) return;
    await command.run(() => clients.analyses.cancel(id!));
    void job.refresh();
  };
  const retry = async () => {
    await command.run(
      () => clients.analyses.retry(id!),
      "Retry requested for missing results.",
    );
    void job.refresh();
  };
  const active =
    !!job.data && ["queued", "preparing", "running"].includes(job.data.status);
  return {
    job: job.data as AnalysisJob | undefined,
    sourceRun: sourceRun.data as Run | undefined,
    loading: job.loading,
    error: job.error,
    refresh: job.refresh,
    active,
    cancelRequested: job.data?.cancelRequested ?? false,
    command,
    cancel,
    retry,
  };
}
