import { z } from 'zod';

export const text = z.string().trim().min(1).max(20000);

export const outcome = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name: text, definition: text, qualifyingCriteria: text,
    presentGuidance: text, absentGuidance: text, uncertainGuidance: text, examples: z.string().max(20000).default(''),
    exclusions: z.string().max(20000).default(''), archived: z.boolean().default(false) }).strict();

export const definitionInput = z.object({ expectedRevision: z.number().int().nonnegative(), questions: text,
    outcomes: z.array(outcome).min(1).max(40) }).strict();

export const settingsInput = z.object({
    model: z.object({ provider: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), id: z.string().trim().min(1).max(160),
        settings: z.object({ temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().min(128).max(32768).optional(),
            topP: z.number().min(0).max(1).optional(), seed: z.number().int().optional() }).strict().default({}) }).strict(),
    maxInputChars: z.number().int().min(1000).max(4000000).default(100000),
    contextWindowTokens: z.number().int().min(1024).max(2000000).default(32768),
    outputAllowanceTokens: z.number().int().min(128).max(32768).default(2048),
    timeoutMs: z.number().int().min(1000).max(600000).default(120000),
});

export const previewInput = settingsInput.extend({ runIds: z.array(z.string().min(1).max(200)).min(1).max(20), definitionRevision: z.number().int().positive() }).strict();

export const launchInput = z.object({ previewId: text, previewHash: text, idempotencyKey: z.string().trim().min(1).max(160) }).strict();
