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
        for await (const attempt of pages(page => this.repository.listAttempts(jobId, { ...page, probe: 'include' })))
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
        progress.failedWindows += Number(latest.status === 'failed') - Number(window.status === 'failed');
        // Oversized windows are deliberately unscored and never retried, so they count as skipped rather than failed.
        progress.skippedWindows += Number(latest.status === 'oversized') - Number(window.status === 'oversized');
        // Per-window deltas keep progress linear. Full history/usage reconciliation runs once at finalization.
        await this.repository.updateCounters(lease, { ...progress });
    }

    async counters(jobId: string, codeCount: number): Promise<JobCounters> {
        const counters = emptyCounters(), submitted = new Set<string>();
        for await (const window of pages(page => this.repository.listWindows(jobId, page))) {
            counters.preparedWindows++;
            // Actor-scoped codes make the question count per window; the prepared batches list exactly the questions it will be asked.
            if (window.status !== 'skipped' && window.status !== 'oversized') counters.expectedAnswers += window.batches?.flat().length || codeCount;
            if (window.status === 'completed') counters.finishedWindows++;
            if (window.status === 'failed') counters.failedWindows++;
            if (window.status === 'skipped' || window.status === 'oversized') counters.skippedWindows++;
        }
        for await (const attempt of pages(page => this.repository.listAttempts(jobId, page))) submitted.add(attempt.windowId);
        counters.submittedWindows = submitted.size;
        for await (const _result of pages(page => this.repository.listResults(jobId, page))) counters.returnedAnswers++;
        return counters;
    }

    private async hasOversizedWindow(jobId: string): Promise<boolean> {
        for await (const window of pages(page => this.repository.listWindows(jobId, page))) if (window.status === 'oversized') return true;
        return false;
    }

    /**
     * Oversized windows count as skipped, but a job that scored nothing because every window was
     * oversized still failed. Everything else keeps the historical terminal-status derivation.
     */
    async finalStatus(jobId: string, counters: JobCounters, cancelled: boolean): Promise<JobStatus> {
        if (cancelled) return 'cancelled';
        if (counters.returnedAnswers === 0 && counters.finishedWindows === 0 && await this.hasOversizedWindow(jobId)) return 'failed';
        return counters.returnedAnswers === counters.expectedAnswers && counters.failedWindows === 0 ? 'completed'
            : counters.returnedAnswers ? 'partial' : 'failed';
    }
}
