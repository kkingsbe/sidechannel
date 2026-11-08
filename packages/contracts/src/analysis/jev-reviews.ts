

export type Decision = 'present' | 'absent' | 'uncertain';

export interface Review {
    id: string; analysisId: string; subjectId: string; scope: 'window' | 'event' | 'run'; codeId: string;
    definitionRevision: string; evidenceRevision: string; reviewer: string; identityVerified: false;
    decision: Decision; rationale: string; eventIds: string[]; stepIds: string[]; predictionsVisible: boolean; revision: number; createdAt: string;
}

export interface ReviewWindow { id: string; eventIds: string[]; stepIds: string[]; probabilities: Record<string, number | null> }

export interface ReviewContext { analysisId: string; runId: string; definitionRevision: string; evidenceRevision: string; codeIds: string[]; windows: ReviewWindow[] }

export interface ReviewBatch {
    id: string; analysisId: string; createdAt: string; definitionRevision: string; evidenceRevision: string; populationHash: string; populationSize: number;
    seed: string; randomSize: number; threshold: number; codeIds: string[]; selectedCount: number; mode: 'assisted' | 'blind';
}

export interface ReviewListFilter { windowId?: string; reviewer?: string; subjectId?: string; scope?: 'window' | 'event' | 'run'; codeId?: string; latest?: boolean }

export type ReviewQueueFilter = 'all' | 'unreviewed' | 'uncertain' | 'disagreement';

export type ReviewReason = 'flagged' | 'random' | 'manual';

/** A stored review-queue member; `order` is the queue sort key minted by the batch. */
export interface ReviewMember { windowId: string; eligible: boolean; selected: boolean; reasons: ReviewReason[]; order: string }

/** Blind queues deliberately omit `reasons`/`order`; assisted queues return full members. */
export interface ReviewQueueItem { windowId: string; selected: boolean; eligible?: boolean; reasons?: ReviewReason[]; order?: string }
