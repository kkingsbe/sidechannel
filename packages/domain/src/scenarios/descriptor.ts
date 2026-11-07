import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import type { Scenario } from '@sidechannel/contracts/harness/server';

export interface ScenarioPresentation {
    title: string;
    tabs: readonly string[];
    hasDatasetPreset: boolean;
}

/** Default evidence tabs every run exposes; scenarios append presentation-only tabs. */
export const EVIDENCE_TABS = ['timeline', 'board', 'artifacts', 'memory', 'reports', 'traces', 'configuration'] as const;

export interface ScenarioDescriptor {
    readonly version: string;
    readonly label: string;
    readonly fixture: boolean;
    readonly artifactSchemaVersion: string;
    readonly toolNames: readonly string[];
    readonly scenario: Scenario;
    readonly scriptedDriverId?: string;
    /** Returns validation errors for a configuration that selects this scenario. */
    validateConfiguration(config: ExperimentConfig): string[];
    /** Dashboard form/tab metadata. */
    readonly presentation: ScenarioPresentation;
}
