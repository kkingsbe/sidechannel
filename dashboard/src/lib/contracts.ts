import type { ComponentType } from 'react';

/** One cursor envelope (Jev `Page` and every paged list agree on this shape). */
export interface Page<T> { items: T[]; nextCursor: string | null }
/** One offset envelope (harness runs, evidence tabs). */
export interface OffsetPage<T> { items: T[]; total: number; nextOffset: number | null }
/** Every persisted research record starts with a server identity and creation time. */
export interface Identified { id: string; createdAt: string }
export type ViewRegistry<TabId extends string> = Record<TabId, { title: string; description?: string; Component: ComponentType }>;
