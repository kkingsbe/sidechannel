import type { CodebookWarning } from '@sidechannel/contracts/browser';
import type { BehaviorCode, Codebook, CodebookRevision, Page } from '../analysis-types';
import type { Requester } from '../transport';
import { withQuery } from '../transport';

export const codebookPaths = {
    list: (query: { limit?: number; after?: string; archived?: 'include' | 'only' } = {}) => withQuery('/codebooks', query),
    get: (id: string) => '/codebooks/' + encodeURIComponent(id),
    revisions: (id: string, query: { limit?: number; after?: string } = {}) => withQuery('/codebooks/' + encodeURIComponent(id) + '/revisions', query),
    revision: (id: string, revisionId: string) => '/codebooks/' + encodeURIComponent(id) + '/revisions/' + encodeURIComponent(revisionId),
    archive: (id: string) => '/codebooks/' + encodeURIComponent(id) + '/archive',
    restore: (id: string) => '/codebooks/' + encodeURIComponent(id) + '/restore',
    /** The proposed v2 seed definitions (no codebook ID: the same content for every codebook). */
    seedV2: () => '/codebooks/seed-v2',
    applySeedV2: (id: string) => '/codebooks/' + encodeURIComponent(id) + '/seed-v2',
};

/** `warnings` are non-blocking validation findings from the save that produced this pair. */
export interface CodebookPair { codebook: Codebook; revision: CodebookRevision; warnings?: CodebookWarning[] }

export interface CodebooksClient {
    paths: typeof codebookPaths;
    list(query?: { limit?: number; after?: string; archived?: 'include' | 'only' }): Promise<Page<Codebook>>;
    get(id: string): Promise<CodebookPair>;
    revisions(id: string, query?: { limit?: number; after?: string }): Promise<Page<CodebookRevision>>;
    revision(id: string, revisionId: string): Promise<CodebookRevision>;
    create(input: { name: string; author: string; codes?: BehaviorCode[] }): Promise<CodebookPair>;
    revise(id: string, input: { expectedRevisionId: string; name: string; author: string; codes: BehaviorCode[] }): Promise<CodebookPair>;
    archive(id: string, input: { expectedRevisionId: string; author: string }): Promise<{ codebook: Codebook }>;
    restore(id: string, input: { expectedRevisionId: string; author: string }): Promise<{ codebook: Codebook }>;
    /** Proposed v2 seed content, for the diff shown before it is applied. */
    seedV2(): Promise<{ definitions: BehaviorCode[] }>;
    /** Appends the v2 seed as a new revision; `expectedRevisionId` guards against a concurrent save. */
    applySeedV2(id: string, input: { expectedRevisionId: string; author: string }): Promise<CodebookPair>;
}

export function createCodebooksClient(request: Requester): CodebooksClient {
    const post = <T,>(path: string, body: unknown, method = 'POST') => request<T>(path, { method, body: JSON.stringify(body) });
    return {
        paths: codebookPaths,
        list: query => request(codebookPaths.list(query)),
        get: id => request(codebookPaths.get(id)),
        revisions: (id, query) => request(codebookPaths.revisions(id, query)),
        revision: (id, revisionId) => request(codebookPaths.revision(id, revisionId)),
        create: input => post(codebookPaths.list(), { name: input.name, creator: input.author, definitions: input.codes ?? [] }),
        revise: (id, input) => {
            if (!input.expectedRevisionId) throw new Error('The edited codebook revision ID is required. Reload its revision before saving.');
            return post(codebookPaths.get(id), { expectedRevisionId: input.expectedRevisionId, name: input.name, creator: input.author, definitions: input.codes }, 'PATCH');
        },
        archive: (id, input) => post(codebookPaths.archive(id), { expectedRevisionId: input.expectedRevisionId, author: input.author }),
        restore: (id, input) => post(codebookPaths.restore(id), { expectedRevisionId: input.expectedRevisionId, author: input.author }),
        seedV2: () => request(codebookPaths.seedV2()),
        applySeedV2: (id, input) => post(codebookPaths.applySeedV2(id), { expectedRevisionId: input.expectedRevisionId, creator: input.author }),
    };
}
