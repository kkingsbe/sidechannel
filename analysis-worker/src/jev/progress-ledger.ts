import { emptyCounters } from '@sidechannel/domain/analysis/jev-repository';
import { pages } from '@sidechannel/domain/analysis/jev-service';
import type { JobCounters, JobLifecycleStore, JobStatus, Lease, ResultStore, WindowRecord, WindowStore } from '@sidechannel/contracts/analysis/jev-repository';

export interface ProgressPorts
    extends Pick<JobLifecycleStore, 'updateCounters'>,
    Pick<WindowStore, 'getWindow' | 'listWindows'>,
    Pick<ResultStore, 'listResults' | 'listAttempts' | 'finishAttempt'> {}

export interface WindowProgress { answers: number; submitted: boolean }

/** Counters are derived from stored state: per-window deltas keep them linear, finalization recounts. */
export class ProgressLedger {
    constructor(private readonly repository: ProgressPorts) {}

    /** A crash can leave an attempt open; record recovery rather than treating it as a negative answer. */
    async recover(lease: Lease, jobId: string): Promise<void> {
        for await (const attempt of pages(page => this.repository.listAttempts(jobId, page)))
            if (attempt.status === 'running')
                await this.repository.finishAttempt(lease, { ...attempt, status: 'failed', finishedAt: new Date().toISOString(),
                    error: 'Previous worker lease expired before this attempt was committed; provider completion and cost may be unknown' }, []);
    }

    async snapshot(jobId: string, window: WindowRecord): Promise<WindowProgress> {
        const answers = (await this.repository.listResults(jobId, { windowId: window.id, limit: 100 })).items.length;
        const submitted = (await this.repository.listAttempts(jobId, { windowId: window.id, limit: 1 })).items.length > 0;
        return { answers, submitted };
    }

    async settle(lease: Lease, jobId: string, window: WindowRecord, progress: JobCounters, prior: WindowProgress): Promise<void> {
        const latest = await this.repository.getWindow(jobId, window.id);
        if (!latest) return;
        const answers = (await this.repository.listResults(jobId, { windowId: window.id, limit: 100 })).items.length;
        const submitted = (await this.repository.listAttempts(jobId, { windowId: window.id, limit: 1 })).items.length > 0;
        progress.returnedAnswers += answers - prior.answers;
        progress.submittedWindows += Number(submitted) - Number(prior.submitted);
        progress.finishedWindows += Number(latest.status === 'completed') - Number(window.status === 'completed');
        progress.failedWindows += Number(latest.status === 'failed' || latest.status === 'oversized') - Number(window.status === 'failed');
        // Per-window deltas keep progress linear. Full history/usage reconciliation runs once at finalization.
        await this.repository.updateCounters(lease, { ...progress });
    }

    async counters(jobId: string, codeCount: number): Promise<JobCounters> {
        const counters = emptyCounters(), submitted = new Set<string>();
        for await (const window of pages(page => this.repository.listWindows(jobId, page))) {
            counters.preparedWindows++;
            if (window.status !== 'skipped') counters.expectedAnswers += codeCount;
            if (window.status === 'completed') counters.finishedWindows++;
            if (window.status === 'failed' || window.status === 'oversized') counters.failedWindows++;
            if (window.status === 'skipped') counters.skippedWindows++;
        }
        for await (const attempt of pages(page => this.repository.listAttempts(jobId, page))) submitted.add(attempt.windowId);
        counters.submittedWindows = submitted.size;
        for await (const _result of pages(page => this.repository.listResults(jobId, page))) counters.returnedAnswers++;
        return counters;
    }

    status(counters: JobCounters, cancelled: boolean): JobStatus {
        return cancelled ? 'cancelled'
            : counters.returnedAnswers === counters.expectedAnswers && counters.failedWindows === 0 ? 'completed'
                : counters.returnedAnswers ? 'partial' : 'failed';
    }
}
