


export interface ReviewDocument { id: string; collection: 'reviews' | 'batches' | 'members'; partition: string; key: string; value: Record<string, unknown> }

export interface ReviewQuery { windowId?: string; eventIds?: string[]; reviewer?: string; subjectId?: string; scope?: 'window' | 'event' | 'run'; codeId?: string; definitionRevision?: string; evidenceRevision?: string; latest?: boolean }

export interface MemberQuery { includeWindowIds?: string[]; excludeWindowIds?: string[] }

export interface ReviewStore {
    insert(record: ReviewDocument): Promise<void>;
    get(collection: ReviewDocument['collection'], partition: string, key: string): Promise<ReviewDocument | null>;
    page(collection: ReviewDocument['collection'], partition: string, after?: string, limit?: number, selectedOnly?: boolean, members?: MemberQuery): Promise<{ items: ReviewDocument[]; nextCursor: string | null }>;
    queryReviews(partition: string, query: ReviewQuery, after?: string, limit?: number): Promise<{ items: ReviewDocument[]; nextCursor: string | null }>;
}