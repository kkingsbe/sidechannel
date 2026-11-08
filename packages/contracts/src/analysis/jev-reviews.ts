

export type Decision = 'present' | 'absent' | 'uncertain';

export interface Review {
    id: string; analysisId: string; subjectId: string; scope: 'window' | 'event' | 'run'; codeId: string;
    definitionRevision: string; evidenceRevision: string; reviewer: string; identityVerified: false;
    decision: Decision; rationale: string; eventIds: string[]; stepIds: string[]; predictionsVisible: boolean; revision: number; createdAt: string;
}

export interface ReviewWindow { id: string; eventIds: string[]; stepIds: string[]; probabilities: Record<string, number | null> }

export interface ReviewContext { analysisId: string; runId: string; definitionRevision: string; evidenceRevision: string; codeIds: string[]; windows: ReviewWindow[] }

/** How a batch chose its windows (v2 spec section 9.2). Absent means the v1 flagged-plus-random selection. */
export type BatchStrategy =
    | { kind: 'flagged-plus-random' }
    | { kind: 'stratified'; bins: number[]; perBin: number }
    | { kind: 'disagreement'; minGap: number };

export interface ReviewBatch {
    id: string; analysisId: string; createdAt: string; definitionRevision: string; evidenceRevision: string; populationHash: string; populationSize: number;
    seed: string; randomSize: number; threshold: number; codeIds: string[]; selectedCount: number; mode: 'assisted' | 'blind';
    strategy?: BatchStrategy;
}

export type ValidationStatus = 'unvalidated' | 'tentative' | 'validated' | 'unreliable';

/** Per-code validation metrics for one (codebook revision, model version) pair (v2 spec section 9.3). */
export interface CodeValidation {
    codeId: string; definitionRevision: string; model: string; status: ValidationStatus;
    labels: number; positives: number; negatives: number; uncertain: number; reviewers: number;
    precision: number | null; recall: number | null; f1: number | null;
    optimalThreshold: number | null; kappaHumanModel: number | null; kappaHumanHuman: number | null;
    noiseFloor: number | null; reasons: string[];
}

export interface ReviewListFilter { windowId?: string; reviewer?: string; subjectId?: string; scope?: 'window' | 'event' | 'run'; codeId?: string; latest?: boolean }

export type ReviewQueueFilter = 'all' | 'unreviewed' | 'uncertain' | 'disagreement';

export type ReviewReason = 'flagged' | 'random' | 'manual' | 'stratified' | 'disagreement';

/** A stored review-queue member; `order` is the queue sort key minted by the batch. */
export interface ReviewMember { windowId: string; eligible: boolean; selected: boolean; reasons: ReviewReason[]; order: string }

/** Blind queues deliberately omit `reasons`/`order`; assisted queues return full members. */
export interface ReviewQueueItem { windowId: string; selected: boolean; eligible?: boolean; reasons?: ReviewReason[]; order?: string }
