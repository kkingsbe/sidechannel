import type { AnalysisConfigurationInput } from './evidence-contracts.js';

export interface PreviewInput { codebookId: string; codebookRevisionId?: string; settings?: AnalysisConfigurationInput; }

export interface LaunchInput extends PreviewInput { previewHash: string; idempotencyKey: string; creator: string; parentAnalysisId?: string; }