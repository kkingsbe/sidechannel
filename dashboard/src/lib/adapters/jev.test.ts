// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createClients } from '../clients/context';
import { createJevRequester, createJevSession, toBatch, toCanonicalSettings, toCodebook, toJob, toSettings, translate } from './jev';
import { batch, book, job, previewPayload, review, revision, serializedWindow, windowRecord } from '../../test/jev-fixtures';

function stub(...responses: unknown[]) {
    const calls: { path: string; options?: RequestInit; body?: any }[] = [];
    const request = async <T,>(path: string, options?: RequestInit): Promise<T> => {
        calls.push({ path, options, body: options?.body ? JSON.parse(String(options.body)) : undefined });
        return structuredClone(responses.shift()) as T;
    };
    return { calls, request };
}

describe('jev adapter', () => {
    it('translate is pure: prefixes Jev routes and rejects every non-Jev route', () => {
        expect(translate('/codebooks?limit=30')).toEqual({ path: '/jev/codebooks?limit=30', init: undefined });
        expect(translate('/analyses/a1/windows?withResults=true')).toEqual({ path: '/jev/analyses/a1/windows?withResults=true', init: undefined });
        expect(translate('/runs/r1/analyses/preview')).toEqual({ path: '/jev/runs/r1/analyses/preview', init: undefined });
        expect(translate('/codebooks/seed-v2')).toEqual({ path: '/jev/codebooks/seed-v2', init: undefined });
        expect(translate('/codebooks/b1/seed-v2')).toEqual({ path: '/jev/codebooks/b1/seed-v2', init: undefined });
        expect(translate('/runs/r1')).toBeUndefined();
        expect(translate('/monitor-evaluations')).toBeUndefined();
        expect(translate('/drafts')).toBeUndefined();
        expect(translate('/runs/r1/outcomes')).toBeUndefined();
    });

    it('the session is bounded, keyed and never module scope', () => {
        const session = createJevSession(2);
        session.rememberJob(job({ id: 'a' }));
        session.rememberJob(job({ id: 'b' }));
        session.rememberJob(job({ id: 'c' }));
        expect(session.job('a')).toBeUndefined();
        expect(session.job('c')?.id).toBe('c');
        const previews = createJevSession();
        for (let index = 0; index < 12; index++) previews.rememberPreview('t' + index, { runId: 'r', body: {} });
        expect(previews.preview('t0')).toBeUndefined();
        expect(previews.preview('t11')).toBeDefined();
    });

    it('two requesters never share cached jobs', async () => {
        const first = createJevRequester(async <T,>(path: string): Promise<T> => (path === '/jev/analyses/a1' ? job({ id: 'a1' }) : {}) as T);
        await first('/analyses/a1');
        const second = createJevRequester(async () => { throw new Error('must not be called'); });
        await expect(second('/analyses/a1')).rejects.toThrow();
    });

    it('maps canonical jobs, windows and their exact evidence state', async () => {
        const record = windowRecord({ results: [{ id: 'r', jobId: 'analysis-a', windowId: 'window-a', codeId: 'visibility', probability: 0, attemptId: 'attempt', createdAt: '2026-11-07T12:00:00Z' }] });
        const server = stub({ items: [record], nextCursor: 'next-page' }, job());
        const clients = createClients({ request: server.request });
        const page = await clients.analyses.windows('analysis-a', { limit: 20 });
        expect(server.calls[0]!.path).toBe('/jev/analyses/analysis-a/windows?withResults=true&limit=20');
        expect(page.nextCursor).toBe('next-page');
        expect(page.items[0]!.results![0]!.probability).toBe(0);
        expect(page.items[0]!.runId).toBe('source-run');
        expect(page.items[0]!.budget.headroom).toBe(4321);
    });

    it('retrieves exact preview window input from the session context', async () => {
        const server = stub(previewPayload({ previewHash: 'frozen' }), { input: serializedWindow(windowRecord(), { state: 'EXACT' }) });
        const clients = createClients({ request: server.request });
        const settings = { codebookId: 'book', codebookRevisionId: 'book-revision-1', model: 'jev-1.14.0', windowSize: 12, stride: 4, phases: ['action' as const], evidence: ['assistant' as const], headroom: 4321, timeoutMs: 60000, maxAttempts: 2, creator: 'Researcher' };
        const preview = await clients.analyses.preview('source-run', settings);
        expect(preview.previewToken).toBe('frozen');
        await expect(clients.analyses.previewWindow('frozen', 'window-a')).resolves.toEqual({ state: 'EXACT' });
    });

    it('maps reviews deterministically from their subject scope', async () => {
        const server = stub(
            { batch: batch({ mode: 'blind' }), items: [{ windowId: 'late-match' }], nextCursor: null },
            { items: [review({ scope: 'event', subjectId: 'event-a' })], nextCursor: null },
            job(),
        );
        const clients = createClients({ request: server.request });
        const queue = await clients.analyses.batch('analysis-a', 'blind-batch', { reviewer: 'Alice' });
        expect(queue.batch.mode).toBe('blind');
        expect(queue.selections.items[0]!.windowId).toBe('late-match');
        const { items } = await clients.analyses.reviews('analysis-a', { windowId: 'window-a' });
        expect(items[0]!.windowId).toBeUndefined();
        expect(items[0]!.subjectId).toBe('event-a');
    });

    it('leaves independent run outcomes and monitor API calls untouched', async () => {
        const request = async (path: string) => { throw new Error('Must not translate ' + path); };
        const jev = createJevRequester(request);
        await expect(jev('/runs/source/outcomes')).rejects.toThrow('Must not translate /runs/source/outcomes');
    });

    it('never invents revision, archived or limit values and freezes what the server returned', () => {
        const canonicalJob = job();
        expect(toJob(canonicalJob)).not.toHaveProperty('revision');
        expect(toBatch(batch())).not.toHaveProperty('revision');
        expect(toBatch(batch())).not.toHaveProperty('creator');
        expect(toCodebook(book(revision()))).not.toHaveProperty('archived');
        const settings = toSettings(canonicalJob.manifest.settings, canonicalJob.manifest.codebook, 'Researcher');
        expect(settings).not.toHaveProperty(['resolved', 'Settings'].join(''));
        expect(settings.frozen!.evidence.toolResults).toBe(false);
        expect(settings.frozen!.inputLimits.singleQuestionTokens).toBe(30000);
        expect(Object.keys(settings.frozen!).sort()).toEqual(['concurrency', 'evidence', 'inputLimits', 'longContext', 'retryBaseMs']);
        const fresh = { codebookId: 'b', codebookRevisionId: 'v', model: 'jev-1.14.0', windowSize: 7, stride: 2, phases: ['report' as const], evidence: ['memory' as const, 'assistant' as const], headroom: 1234, timeoutMs: 23456, maxAttempts: 2, creator: 'Claimed' };
        const canonical = toCanonicalSettings(fresh);
        expect(canonical.inputLimits).toMatchObject({ singleQuestionTokens: 32000, combinedQuestionTokens: 64000, maxBodyBytes: 33554432, headroomTokens: 1234 });
        expect(Object.entries(canonical.evidence!).filter(([, on]) => on).map(([key]) => key).sort()).toEqual(['assistantText', 'privateMemory']);
    });

    it('keeps every resolved setting when previewing a duplicated analysis', async () => {
        const server = stub(job(), previewPayload());
        const clients = createClients({ request: server.request });
        const loaded = await clients.analyses.job('analysis-a');
        await clients.analyses.preview('source-run', loaded.manifest.settings);
        const body = server.calls.at(-1)!.body;
        expect(body.settings.evidence).toMatchObject({ assistantText: true, toolResults: false, boardContent: false });
        expect(body.settings.inputLimits).toMatchObject({ singleQuestionTokens: 30000, headroomTokens: 4321 });
        expect(body.codebookId).toBe('book');
    });
});
