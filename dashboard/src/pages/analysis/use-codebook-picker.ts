import { useEffect } from "react";
import { useClients } from "../../lib/clients/context";
import { useResource, useResourcePage } from "../../lib/clients/query";
import type { AnalysisSettings, Codebook, CodebookRevision } from "../../lib/analysis-types";

/** Codebook/revision selection: the two pagers plus the effective frozen revision. */
export function useCodebookPicker(input: {
  settings: AnalysisSettings;
  change(patch: Partial<AnalysisSettings>): void;
}) {
  const clients = useClients();
  const { settings, change } = input;
  const books = useResourcePage<Codebook>("analysis:setup:books", (cursor) =>
    clients.codebooks.list({ limit: 30, after: cursor ?? undefined }),
  );
  const revision = useResource<{ codebook: Codebook; revision: CodebookRevision }>(
    settings.codebookId
      ? `analysis:setup:codebook:${settings.codebookId}`
      : null,
    () => clients.codebooks.get(settings.codebookId),
  );
  const revisionHistory = useResourcePage<CodebookRevision>(
    settings.codebookId
      ? `analysis:setup:revisions:${settings.codebookId}`
      : null,
    (cursor) =>
      clients.codebooks.revisions(settings.codebookId, {
        limit: 30,
        after: cursor ?? undefined,
      }),
  );
  useEffect(() => {
    const first = books.data[0];
    if (settings.codebookId || !first) return;
    change({
      codebookId: first.id,
      codebookRevisionId: first.currentRevisionId,
    });
  }, [books.data, settings.codebookId, change]);
  const currentRevision =
    revisionHistory.data.find((r) => r.id === settings.codebookRevisionId) ??
    revision.data?.revision;
  return {
    books,
    revision,
    revisionHistory,
    currentRevision,
    loading: books.loading,
    error: books.error,
  };
}
