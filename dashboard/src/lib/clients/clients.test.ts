// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createClients } from './context';
import type { Requester } from '../transport';
import { job } from '../../test/jev-fixtures';

function stub(...responses: unknown[]) {
    const calls: { path: string; options?: RequestInit; body?: any }[] = [];
    const request: Requester = async <T,>(path: string, options?: RequestInit): Promise<T> => {
        calls.push({ path, options, body: options?.body ? JSON.parse(String(options.body)) : undefined });
        return structuredClone(responses.shift()) as T;
    };
    return { calls, request };
}

describe('runs client', () => {
    it('encodes run list queries and returns the offset envelope', async () => {
        const server = stub({ items: [{ id: 'r1' }], total: 1, nextOffset: null });
        const { runs } = createClients({ request: server.request });
        await expect(runs.list({ summary: true, status: 'failed,interrupted', limit: 25, offset: 50 }))
            .resolves.toEqual({ items: [{ id: 'r1' }], total: 1, nextOffset: null });
        expect(server.calls[0]!.path).toBe('/runs?summary=true&status=failed%2Cinterrupted&limit=25&offset=50');
    });

    it('normalises the numeric event cursor to an opaque string and honours hasMore', async () => {
        const server = stub({ events: [{ id: 'e1', sequence: 4 }], items: [{ id: 'e1', sequence: 4 }], nextCursor: 4, hasMore: false });
        const { runs } = createClients({ request: server.request });
        await expect(runs.events('r1', { limit: 50, phase: 'action' })).resolves.toEqual({ items: [{ id: 'e1', sequence: 4 }], nextCursor: null });
        expect(server.calls[0]!.path).toBe('/runs/r1/events?limit=50&phase=action');
    });

    it('exposes export URLs and mutations without a page building a path', async () => {
        const server = stub({ id: 'r1', status: 'stopping' }, { id: 'd1' });
        const { runs } = createClients({ request: server.request });
        expect(runs.exportUrl('r1')).toBe('/api/runs/r1/export');
        expect(runs.paths.board('r1', { limit: 30, offset: 60 })).toBe('/runs/r1/board?limit=30&offset=60');
        await expect(runs.cancel('r1')).resolves.toMatchObject({ status: 'stopping' });
        await expect(runs.duplicate('r1')).resolves.toEqual({ id: 'd1' });
        expect(server.calls.map(call => `${call.options?.method ?? 'GET'} ${call.path}`)).toEqual(['POST /runs/r1/cancel', 'POST /runs/r1/duplicate']);
    });
});

describe('analyses client', () => {
    it('previews and then launches with the frozen preview token', async () => {
        const server = stub(
            { previewHash: 'frozen', runId: 'run-1', windowCount: 1, scoredCodeCount: 1, partialWindows: 0, evidenceAvailability: {}, diagnostics: [], windows: [] },
            job({ id: 'analysis-1', runId: 'run-1', status: 'queued' }),
        );
        const { analyses } = createClients({ request: server.request });
        const settings = { codebookId: 'book', codebookRevisionId: 'revision-1', model: 'jev-1.14.0', windowSize: 12, stride: 4, phases: ['action'], evidence: ['assistant'], headroom: 2000, timeoutMs: 60000, maxAttempts: 2, creator: 'Researcher' } as never;
        await expect(analyses.preview('run-1', settings)).resolves.toMatchObject({ previewToken: 'frozen' });
        await analyses.launch('run-1', settings as any, 'frozen');
        expect(server.calls[0]!.path).toBe('/jev/runs/run-1/analyses/preview');
        expect(server.calls[1]!.path).toBe('/jev/runs/run-1/analyses');
        expect(server.calls[1]!.body).toMatchObject({ previewHash: 'frozen', idempotencyKey: 'frozen', codebookRevisionId: 'revision-1' });
    });

    it('exposes both analysis export URLs', () => {
        const { analyses } = createClients({ request: stub().request });
        expect(analyses.exportUrl('a1')).toBe('/api/jev/analyses/a1/export');
        expect(analyses.datasetExportUrl('a1', 'analysis')).toBe('/api/analyses/a1/export?dataset=analysis&limit=100');
    });

    it('addresses Jev routes through the adapter, not through page-built strings', async () => {
        const server = stub({ items: [], nextCursor: null }, { items: [], nextCursor: null });
        const { analyses, codebooks } = createClients({ request: server.request });
        await analyses.list({ limit: 30 });
        await codebooks.list({ limit: 30 });
        expect(server.calls.map(call => call.path)).toEqual(['/jev/analyses?limit=30', '/jev/codebooks?limit=30']);
    });

    it('keeps the explicit revision requirement for codebook saves', () => {
        const server = stub();
        const { codebooks } = createClients({ request: server.request });
        expect(() => codebooks.revise('book', { expectedRevisionId: '', name: 'name', author: 'author', codes: [] }))
            .toThrow('revision ID is required');
        expect(server.calls).toHaveLength(0);
    });
});
