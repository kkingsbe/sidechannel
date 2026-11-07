import type { ResearchRecord, ResearchFilter, ResearchStore } from '@sidechannel/contracts/analysis/store';
import { jsonHash } from '../hashing.js';

export const hash = jsonHash;

export const timestamp = (): string => new Date().toISOString();

export async function allRecords<T extends ResearchRecord>(store: ResearchStore, collection: string, filter: ResearchFilter = {}): Promise<T[]> { const result: T[] = []; let after: string | undefined; do { const page = await store.page<T>(collection, filter, after, 200); result.push(...page.items); after = page.nextCursor ?? undefined; } while (after); return result; }