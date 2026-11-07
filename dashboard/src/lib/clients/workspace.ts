import type { AdaptionModelCatalog, DatasetCatalogItem, ExperimentConfig } from '@sidechannel/contracts/browser';
import type { Draft } from '../types';
import type { Requester } from '../transport';

export interface ConfigField { path: string; required: boolean }
export interface ConfigSchema { fields: ConfigField[] }
export interface Validation { valid: boolean; errors: string[]; fieldErrors?: Record<string, string>; config?: ExperimentConfig }
export interface OverviewData {
    observedAt: string; counts: Record<string, number>;
    activity: unknown[]; recent: unknown[]; attention: unknown[];
    worker: { capacity: number; available: boolean | null; status: string; note?: string };
    queue?: unknown[]; queueTotal?: number;
}

export const workspacePaths = {
    mode: () => '/workspace',
    overview: () => '/overview',
    drafts: () => '/drafts',
    draft: (id: string) => '/drafts/' + encodeURIComponent(id),
    saveDraft: () => '/drafts',
    duplicateDraft: (id: string) => '/drafts/' + encodeURIComponent(id) + '/duplicate',
    defaults: () => '/config/default',
    schema: () => '/config/schema',
    validate: () => '/config/validate',
    datasets: () => '/datasets',
    preset: (datasetId: string) => '/datasets/' + encodeURIComponent(datasetId) + '/preset',
    adaptionModels: () => '/models/adaption',
};

export interface WorkspaceClient {
    paths: typeof workspacePaths;
    mode(): Promise<{ mode: 'demo' | 'research' }>;
    overview(): Promise<OverviewData>;
    drafts(): Promise<Draft[]>;
    draft(id: string): Promise<Draft>;
    saveDraft(input: { id?: string; revision?: number; config: unknown; name?: string; notes?: string }): Promise<Draft>;
    duplicateDraft(id: string): Promise<Draft>;
    defaults(): Promise<ExperimentConfig>;
    schema(): Promise<ConfigSchema>;
    validate(config: ExperimentConfig): Promise<Validation>;
    datasets(): Promise<DatasetCatalogItem[]>;
    preset(datasetId: string): Promise<ExperimentConfig>;
    adaptionModels(): Promise<AdaptionModelCatalog>;
}

export function createWorkspaceClient(request: Requester): WorkspaceClient {
    const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
    return {
        paths: workspacePaths,
        mode: () => request(workspacePaths.mode()),
        overview: () => request(workspacePaths.overview()),
        drafts: () => request(workspacePaths.drafts()),
        draft: id => request(workspacePaths.draft(id)),
        saveDraft: input => post(workspacePaths.saveDraft(), input),
        duplicateDraft: id => post(workspacePaths.duplicateDraft(id), {}),
        defaults: () => request(workspacePaths.defaults()),
        schema: () => request(workspacePaths.schema()),
        validate: config => post(workspacePaths.validate(), { config }),
        datasets: () => request(workspacePaths.datasets()),
        preset: datasetId => request(workspacePaths.preset(datasetId)),
        adaptionModels: () => request(workspacePaths.adaptionModels()),
    };
}
