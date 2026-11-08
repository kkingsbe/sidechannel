import type { ComponentType } from 'react';
import type { ArtifactVersion, BoardMessage, HarnessEvent, Json, Run, RunStatus } from '@sidechannel/contracts/browser';

/** One cursor envelope (Jev `Page` and every paged list agree on this shape). */
export interface Page<T> { items: T[]; nextCursor: string | null }
/** One offset envelope (harness runs, evidence tabs). */
export interface OffsetPage<T> { items: T[]; total: number; nextOffset: number | null }
/** Every persisted research record starts with a server identity and creation time. */
export interface Identified { id: string; createdAt: string }
export type ViewRegistry<TabId extends string> = Record<TabId, { title: string; description?: string; Component: ComponentType }>;

export interface RunReport { agentId: string; raw: string; parsed: Json | null }
export interface ReportingInstructions { instructions: string; schemaVersion: string }
export interface BoardPage extends OffsetPage<BoardMessage> {
    posts: BoardMessage[];
    deliveries: HarnessEvent[];
    nextDeliveryCursor: number;
    deliveriesMayHaveMore: boolean;
}
export interface ArtifactPage extends OffsetPage<ArtifactVersion> { reporting?: ReportingInstructions }
export interface ReportPage extends OffsetPage<RunReport> { reporting?: ReportingInstructions }
export interface MemoryPage { items: HarnessEvent[]; nextOffset: number | null }
export interface EvidencePages { board: BoardPage; artifacts: ArtifactPage; reports: ReportPage; memory: MemoryPage }
export type RunTab = keyof EvidencePages;

/** Explicit authority for polling: observed fields come from progress, everything else from the frozen run. */
export interface RunProgress {
    id: string; status: RunStatus; round: number; turn: number; updatedAt: string;
    activeAgentId?: string; failureReason?: string; cancelRequested?: boolean;
    usage?: Record<string, number>;
    observedAt: string; executionPhase: 'action' | 'report'; rounds: number;
}
export function mergeProgress(run: Run, progress: RunProgress | undefined): Run {
    if (!progress) return run;
    return {
        ...run, config: run.config,
        status: progress.status, round: progress.round, turn: progress.turn, updatedAt: progress.updatedAt,
        ...(progress.activeAgentId !== undefined ? { activeAgentId: progress.activeAgentId } : {}),
        ...(progress.failureReason !== undefined ? { failureReason: progress.failureReason } : {}),
        ...(progress.cancelRequested !== undefined ? { cancelRequested: progress.cancelRequested } : {}),
        ...(progress.usage !== undefined ? { usage: progress.usage } : {}),
    };
}
