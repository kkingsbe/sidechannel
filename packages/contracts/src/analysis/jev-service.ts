import type { AnalysisConfigurationInput } from './evidence-contracts.js';

/** `settings.preset` selects a named bundle (v2 spec section 7); explicit settings override the preset's values. */
export interface PreviewInput { codebookId: string; codebookRevisionId?: string; settings?: AnalysisConfigurationInput; }

export interface LaunchInput extends PreviewInput { previewHash: string; idempotencyKey: string; creator: string; parentAnalysisId?: string; }