import type { ExperimentConfig, Run } from './contracts.js';

export interface Draft {
    id: string;
    config: unknown;
    revision: number;
    name?: string;
    notes?: string;
    groupId?: string;
    lineage?: { sourceType: 'draft' | 'run' | 'pair'; sourceId: string; sourceRevision?: number };
    updatedAt: string;
}

export type DraftMetadata = Pick<Draft, 'name' | 'notes' | 'groupId' | 'lineage'>;

export class RepositoryConflict extends Error { readonly status = 409; }

/** `after`/`before` are exclusive sequence bounds; `order: 'desc'` returns newest first (used with `before`). */
export interface EventQuery { after?: number; before?: number; order?: 'asc' | 'desc'; offset?: number; limit?: number; actor?: string; phase?: string; type?: string; from?: number; to?: number }

/** One agent turn in a run's event log, for timeline navigation. Run-level events (no agent or turn 0) belong to no turn. */
export interface TurnSummary { agentId: string; round?: number; turn: number; firstSequence: number; lastSequence: number; eventCount: number; modelCalls: number; failures: number }

export interface RunQuery { status?: string; model?: string; condition?: string; scenario?: string; designation?: string; order?: 'recent' | 'queue'; limit: number; offset: number }

export type EvidenceKind = 'board' | 'artifacts' | 'reports';

export interface EvidencePage { items: unknown[]; total: number; reporting?: { instructions: string; schemaVersion: string } }

export type RunSummary = Omit<Run, 'board' | 'artifacts' | 'reports' | 'operations' | 'scenarioState' | 'config'> & { config: Pick<ExperimentConfig, 'label' | 'phase' | 'model' | 'condition' | 'scheduler'> & { scenario: Omit<ExperimentConfig['scenario'], 'assets'> }; designation: string; sourceCompleteness: string };