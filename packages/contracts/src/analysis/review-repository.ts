export type ReviewKind = 'reviews' | 'batches' | 'members';

export interface ReviewDocument<V = unknown> { id: string; collection: ReviewKind; partition: string; key: string; value: V }

/** One stored row as returned by the store; the caller names the value type, so domain never downcasts. */
export interface ReviewRow<T> { key: string; value: T }

export interface ReviewQuery { windowId?: string; eventIds?: string[]; reviewer?: string; subjectId?: string; scope?: 'window' | 'event' | 'run'; codeId?: string; definitionRevision?: string; evidenceRevision?: string; latest?: boolean }

export interface MemberQuery { includeWindowIds?: string[]; excludeWindowIds?: string[] }

export interface ReviewStore {
    insert<T>(kind: ReviewKind, partition: string, key: string, value: T): Promise<void>;
    get<T>(kind: ReviewKind, partition: string, key: string): Promise<ReviewRow<T> | null>;
    page<T>(kind: ReviewKind, partition: string, after?: string, limit?: number, selectedOnly?: boolean, members?: MemberQuery): Promise<{ items: ReviewRow<T>[]; nextCursor: string | null }>;
    queryReviews<T>(partition: string, query: ReviewQuery, after?: string, limit?: number): Promise<{ items: ReviewRow<T>[]; nextCursor: string | null }>;
}

/** The `:`-suffixed zero-padded revision segment is store layout; domain must never build it. */
export const reviewRevisionKey = (identity: string, revision: number): string => `${identity}:${String(revision).padStart(10, '0')}`;
