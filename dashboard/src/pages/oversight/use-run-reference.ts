import { useEffect, useState } from "react";
import { REVIEWER_STORAGE_KEY } from "../../components/claimed-reviewer";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import { useResource, useResourcePage } from "../../lib/clients/query";
import type { MonitorDefinition, Verdict } from "@sidechannel/contracts/browser";
import type {
  RunOutcomeAgreement,
  RunOutcomeReview,
  RunReviewContext,
} from "../../lib/types";
import { list } from "../../lib/utils";

/** Claimed identity, selected outcome and the saved revision state for one source run. */
export function useRunReference(runId: string, initialDefinitionRevisionId?: string) {
  const [definitionRevisionId, setDefinitionRevisionId] = useState(
    initialDefinitionRevisionId || "",
  );
  const clients = useClients();
  const context = useResource<RunReviewContext>(
    `oversight:reference-context:${runId}:${definitionRevisionId}`,
    async () =>
      (await clients.reviews.context(
        runId,
        definitionRevisionId || undefined,
      )) as RunReviewContext,
  );
  const reviews = useResourcePage<RunOutcomeReview>(
    `oversight:reference-reviews:${runId}`,
    (cursor) =>
      clients.reviews.list(runId, { limit: 25, after: cursor ?? undefined }),
    { interval: 5000 },
  );
  const agreements = useResource<RunOutcomeAgreement[]>(
    `oversight:reference-agreements:${runId}`,
    async () => (await clients.reviews.outcomes(runId)) as RunOutcomeAgreement[],
    { interval: 5000 },
  );
  const [reviewer, setReviewer] = useState(
    () => localStorage.getItem(REVIEWER_STORAGE_KEY) || "",
  );
  const [outcomeId, setOutcomeId] = useState("");
  const [decision, setDecision] = useState<Verdict>("uncertain");
  const [rationale, setRationale] = useState("");
  const [evidence, setEvidence] = useState("");
  const command = useCommand();
  const latestQuery = {
    reviewer: reviewer.trim().normalize("NFKC").toLocaleLowerCase("en-US"),
    outcomeId,
    definitionRevisionId: context.data?.definition.id || "",
  };
  const latest = useResource<RunOutcomeReview | null>(
    context.data && reviewer.trim() && outcomeId
      ? `oversight:reference-latest:${runId}:${latestQuery.reviewer}:${latestQuery.outcomeId}:${latestQuery.definitionRevisionId}`
      : null,
    () => clients.reviews.latest(runId, latestQuery),
    { interval: 5000 },
  );
  useEffect(() => {
    if (context.data)
      setOutcomeId(
        context.data.definition.outcomes.find((o) => !o.archived)?.id || "",
      );
  }, [context.data]);
  const save = async () => {
    if (!context.data) return;
    const result = await command.run(
      () =>
        clients.reviews.save(runId, {
          reviewer,
          outcomeId,
          definitionRevisionId: context.data!.definition.id,
          evidenceRevision: context.data!.evidenceRevision,
          decision,
          rationale,
          eventIds: list(evidence),
          supersedesId: latest.data?.id,
        }),
      "Human outcome review appended. Finalization requires two distinct reviewers to agree.",
    );
    if (result) {
      void reviews.refresh();
      void agreements.refresh();
      void latest.refresh();
      setRationale("");
    }
  };
  return {
    definitionRevisionId,
    setDefinitionRevisionId,
    context,
    reviews,
    agreements,
    reviewer,
    setReviewer,
    outcomeId,
    setOutcomeId,
    decision,
    setDecision,
    rationale,
    setRationale,
    evidence,
    setEvidence,
    command,
    latest,
    save,
  };
}

export type { MonitorDefinition };
