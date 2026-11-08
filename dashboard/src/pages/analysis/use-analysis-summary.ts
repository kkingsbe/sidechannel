import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { AnalysisSummary, ThresholdPolicy } from "../../lib/analysis-types";
import { DEFAULT_POLICY } from "./summary-view";

/** The run summary (spec 8.1) for one analysis under a policy. A failed load leaves `data` empty; callers degrade quietly. */
export function useAnalysisSummary(id: string | undefined, policy: ThresholdPolicy = DEFAULT_POLICY, enabled = true) {
  const clients = useClients();
  return useResource<AnalysisSummary>(
    id && enabled ? `analysis:${id}:summary:${JSON.stringify(policy)}` : null,
    () => clients.analyses.summary(id!, policy),
  );
}
