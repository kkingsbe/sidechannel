import { useMemo } from "react";
import { useApi } from "../../lib/api";
import { useClients } from "../../lib/clients/context";
import { createValidationClient, type CodeValidationMetrics, type ValidationReport } from "../../lib/clients/validation";
import type { AnalysisJob } from "../../lib/analysis-types";

/**
 * Validation status per code for the analysis's codebook and model. Statuses are keyed by codebook revision and
 * model, so a code the server has not validated simply has no entry.
 */
export function useCodeValidation(job: AnalysisJob) {
  const { request } = useClients();
  const client = useMemo(() => createValidationClient(request), [request]);
  const { codebookId, model } = job.manifest.settings;
  const report = useApi<ValidationReport>(codebookId && model ? client.paths.validation(codebookId, model) : null);
  const byCode = useMemo(() => new Map<string, CodeValidationMetrics>((report.data?.items ?? []).map((item) => [item.codeId, item])), [report.data]);
  return { byCode, loading: report.loading, error: report.error };
}
