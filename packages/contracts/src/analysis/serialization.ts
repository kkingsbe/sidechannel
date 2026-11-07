import type { InputLimits } from './evidence-contracts.js';

export interface BudgetQuestion { codeId: string; instructions: string; criteria?: { true: string; false: string }; }

export interface QuestionBatch { codeIds: string[]; bytes: number; estimatedTokens: number; }

export interface WindowPreflight { oversized: boolean; reason?: string; batches: QuestionBatch[]; bytes: number; estimatedTokens: number; estimatorVersion: string; effectiveLimits: InputLimits; }