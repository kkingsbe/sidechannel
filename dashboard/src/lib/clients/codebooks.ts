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
};

export interface CodebookPair { codebook: Codebook; revision: CodebookRevision }

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
    };
}
