import { DomainFailure } from '../errors.js';
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

export class RepositoryConflict extends DomainFailure { constructor(message: string) { super('conflict', message); } }

export interface EventQuery { after?: number; offset?: number; limit?: number; actor?: string; phase?: string; type?: string; from?: number; to?: number }

export interface RunQuery { status?: string; model?: string; condition?: string; scenario?: string; designation?: string; order?: 'recent' | 'queue'; limit: number; offset: number }

export type EvidenceKind = 'board' | 'artifacts' | 'reports';

export interface EvidencePage { items: unknown[]; total: number; reporting?: { instructions: string; schemaVersion: string } }

/**
 * Run fields that are never part of a `RunSummary`. These live in contracts because `RunSummary` is
 * the browser-facing shape and contracts cannot import domain; `@sidechannel/domain/harness/repository`
 * re-exports them and derives the Mongo projection from them, so adding a heavy `Run` field is one
 * edit here plus the `Run` interface (finding P4).
 */
export const SUMMARY_OMIT = ['board', 'artifacts', 'reports', 'operations', 'scenarioState'] as const;

/** Scenario sub-fields that a summary never carries. */
export const SUMMARY_CONFIG_OMIT = ['assets'] as const;

export type RunSummaryOmittedField = typeof SUMMARY_OMIT[number];

export type RunSummaryScenarioOmittedField = typeof SUMMARY_CONFIG_OMIT[number];

export type RunSummary = Omit<Run, RunSummaryOmittedField | 'config'> & { config: Pick<ExperimentConfig, 'label' | 'phase' | 'model' | 'condition' | 'scheduler'> & { scenario: Omit<ExperimentConfig['scenario'], RunSummaryScenarioOmittedField> }; designation: string; sourceCompleteness: string };