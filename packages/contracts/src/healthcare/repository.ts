import type { DatasetCatalogItem, EvaluatorReference, HealthcareAssets, HealthcareEvaluation, HealthcareManifest, HealthcareTruth, ValidatedHealthcarePackage } from './contracts.js';
export interface RuntimeDataset { item: DatasetCatalogItem; manifest: HealthcareManifest; assets: HealthcareAssets; truthHash: string; }
export interface HealthcareCatalog {
    register(value: ValidatedHealthcarePackage): Promise<DatasetCatalogItem>;
    list(): Promise<DatasetCatalogItem[]>;
    runtime(datasetId: string, datasetVersion: string): Promise<RuntimeDataset | null>;
    provenance(datasetId: string, datasetVersion: string): Promise<HealthcareManifest | null>;
    freezeReference(reference: EvaluatorReference): Promise<void>;
    getReference(runId: string): Promise<EvaluatorReference | null>;
    evaluatorTruth(reference: EvaluatorReference): Promise<HealthcareTruth>;
    saveEvaluation(evaluation: HealthcareEvaluation): Promise<HealthcareEvaluation>;
    getEvaluation(runId: string, artifactVersion: number, evaluatorVersion: string): Promise<HealthcareEvaluation | null>;
    /** Removes the run's frozen evaluator reference and every stored evaluation. Idempotent; returns the rows removed. */
    deleteRunRecords(runId: string): Promise<{ references: number; evaluations: number }>;
}
