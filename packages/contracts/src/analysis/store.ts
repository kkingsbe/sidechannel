export interface ResearchRecord { id: string; revision: number; createdAt: string }

export interface Page<T> { items: T[]; nextCursor: string | null }

/**
 * Every collection the research store serves. Adapters reject anything outside this union at compile time.
 * `records` is the synthetic collection the shared adapter contract suite stores fixture rows in; it is
 * not a production collection (production rows live in the five monitor/run-review collections).
 */
export type ResearchCollection = 'monitor_definitions' | 'monitor_previews' | 'monitor_preview_parts' | 'monitor_evaluations' | 'run_outcome_reviews' | 'records';

export type ResearchFilter = Record<string, string | number | boolean | undefined>;

export interface ResearchStore {
  get<T extends ResearchRecord>(collection: ResearchCollection, id: string): Promise<T | null>;
  insert<T extends ResearchRecord>(collection: ResearchCollection, record: T): Promise<boolean>;
  replace<T extends ResearchRecord>(collection: ResearchCollection, id: string, expectedRevision: number, record: T): Promise<boolean>;
  page<T extends ResearchRecord>(collection: ResearchCollection, filter?: ResearchFilter, after?: string, limit?: number): Promise<Page<T>>;
  claim(scope: string, id: string, owner: string, ttlMs: number): Promise<boolean>;
  renew(scope: string, id: string, owner: string, ttlMs: number): Promise<boolean>;
  release(scope: string, id: string, owner: string): Promise<void>;
}

/** Physical key layout for chunked blobs belongs to the store contract, not to domain code. */
export const previewPartKey = (id: string, index: number): string => `${id}:${index}`;
