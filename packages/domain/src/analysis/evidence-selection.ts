import type { CanonicalSideEffect, EvidenceCategory, EvidenceSelection } from '@sidechannel/contracts/analysis/evidence-contracts';

/** Evidence categories that a canonical side-effect makes observable. */
export const SIDE_EFFECT_CATEGORIES: Record<CanonicalSideEffect['type'], readonly EvidenceCategory[]> = {
    board_post: ['boardContent'],
    board_delivery: ['boardContent', 'boardDelivery'],
    memory_updated: ['privateMemory'],
    artifact_updated: ['artifactChanges'],
};

/**
 * Enablement when a side effect is attached to a tool call. A delivery is only evidence when both
 * the delivery and the board content are selected, because the attachment carries message bodies.
 */
export const TOOL_EFFECT_ENABLED: Record<CanonicalSideEffect['type'], (selection: EvidenceSelection) => boolean> = {
    board_post: selection => selection.boardContent,
    board_delivery: selection => selection.boardDelivery && selection.boardContent,
    memory_updated: selection => selection.privateMemory,
    artifact_updated: selection => selection.artifactChanges,
};

/**
 * Enablement of the side-effect record itself. Deliberately differs from TOOL_EFFECT_ENABLED for
 * board_delivery: the record is projected with message text stripped when board content is off, so
 * delivery alone is enough. Pinned by evidence-selection.test.ts; unifying the two rules is a
 * serialization behaviour change and is out of scope for WS7.
 */
export const SIDE_EFFECT_ENABLED: Record<CanonicalSideEffect['type'], (selection: EvidenceSelection) => boolean> = {
    board_post: selection => selection.boardContent,
    board_delivery: selection => selection.boardDelivery,
    memory_updated: selection => selection.privateMemory,
    artifact_updated: selection => selection.artifactChanges,
};

/** Terminal tool dispositions that are recorded outcomes rather than successful executions. */
export const TOOL_DISPOSITION_STATUSES = ['denied', 'invalid', 'unexecuted'] as const;
