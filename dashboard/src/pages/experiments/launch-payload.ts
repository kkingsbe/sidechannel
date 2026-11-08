import type { Draft, ExperimentConfig } from "../../lib/types";

export interface LaunchPayload {
  config: ExperimentConfig;
  idempotencyKey: string;
  pairingSeed: number | undefined;
  sourceDraftId?: string;
  sourceDraftRevision?: number;
}

/** The matched-pair launch body. Draft provenance is sent only for an unmodified saved draft. */
export function buildLaunchPayload({
  config,
  launchKey,
  dirty,
  draft,
}: {
  config: ExperimentConfig;
  launchKey: string;
  dirty: boolean;
  draft: Draft | undefined;
}): LaunchPayload {
  return {
    config,
    idempotencyKey: launchKey,
    pairingSeed: config.scheduler.seed,
    ...(!dirty && draft
      ? { sourceDraftId: draft.id, sourceDraftRevision: draft.revision }
      : {}),
  };
}
