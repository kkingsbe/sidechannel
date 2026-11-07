

export interface ResearchRecord { id: string; revision: number; createdAt: string }

export interface Page<T> { items: T[]; nextCursor: string | null }


export type ResearchFilter = Record<string, unknown>;

export interface ResearchStore {
  get<T extends ResearchRecord>(collection: string, id: string): Promise<T | null>;
  insert<T extends ResearchRecord>(collection: string, record: T): Promise<boolean>;
  replace<T extends ResearchRecord>(collection: string, id: string, expectedRevision: number, record: T): Promise<boolean>;
  page<T extends ResearchRecord>(collection: string, filter?: ResearchFilter, after?: string, limit?: number): Promise<Page<T>>;
  claim(scope: string, id: string, owner: string, ttlMs: number): Promise<boolean>;
  renew(scope: string, id: string, owner: string, ttlMs: number): Promise<boolean>;
  release(scope: string, id: string, owner: string): Promise<void>;
}