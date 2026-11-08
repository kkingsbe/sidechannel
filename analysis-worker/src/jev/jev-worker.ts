import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AnalysisConfiguration } from '@sidechannel/contracts/analysis/evidence-contracts';
import { buildBehaviorQuestions } from '@sidechannel/domain/analysis/jev-questions';
import type { JevProvider } from '@sidechannel/contracts/analysis/jev-provider';
import type { AnalysisWorkerStore } from '@sidechannel/contracts/analysis/jev-repository';
import { pages } from '@sidechannel/domain/analysis/jev-service';
import { TypeSafeJevProvider } from './jev-provider.js';
import { LeaseKeeper } from './lease-keeper.js';
import { WindowRunner } from './window-runner.js';
import { ProgressLedger } from './progress-ledger.js';
import { UsageReconciler } from './usage-reconciler.js';

export interface AnalysisWorkerOptions { owner?: string; leaseMs?: number; heartbeatMs?: number; provider?: JevProvider; providerFactory?: (settings: AnalysisConfiguration) => JevProvider; }

/** Owns analysis leases only. Never invokes or mutates the experiment scheduler. */
export class AnalysisWorker {
    private readonly owner: string; private readonly leaseMs: number; private readonly heartbeatMs: number;
    private readonly windows: WindowRunner; private readonly progress: ProgressLedger; private readonly usage: UsageReconciler;

    constructor(private readonly repository: AnalysisWorkerStore, private readonly options: AnalysisWorkerOptions = {}) {
        this.owner = options.owner ?? randomUUID();
        this.leaseMs = options.leaseMs ?? 30_000;
        this.heartbeatMs = options.heartbeatMs ?? Math.floor(this.leaseMs / 3);
        if (this.leaseMs < 100 || this.heartbeatMs < 10 || this.heartbeatMs >= this.leaseMs) throw new Error('Heartbeat must be shorter than a positive lease');
        this.windows = new WindowRunner(repository);
        this.progress = new ProgressLedger(repository);
        this.usage = new UsageReconciler(repository);
    }

    async run(signal: AbortSignal) { while (!signal.aborted) { if (!await this.runOnce(signal)) try { await delay(500, undefined, { signal }); } catch {} } }

    async runOnce(signal?: AbortSignal): Promise<boolean> {
        const claimed = await this.repository.claim(this.owner, new Date().toISOString(), this.leaseMs);
        if (!claimed) return false;
        const { job, lease } = claimed;
        const keeper = new LeaseKeeper(this.repository, lease, job, { leaseMs: this.leaseMs, heartbeatMs: this.heartbeatMs }, signal);
        let provider: JevProvider | undefined;
        let pending: Promise<void>[] = [];
        keeper.start();
        try {
            if (!job.cancelRequested)
                provider = this.options.provider ?? this.options.providerFactory?.(job.manifest.settings) ?? new TypeSafeJevProvider({ timeoutMs: job.manifest.settings.timeoutMs, maxAttempts: job.manifest.settings.maxAttempts, retryBaseMs: job.manifest.settings.retryBaseMs });
            await this.progress.recover(lease, job.id);
            const questions = buildBehaviorQuestions(job.manifest.codebook.definitions), allIds = questions.map(question => question.codeId);
            const progress = await this.progress.counters(job.id, allIds.length);
            for await (const window of pages(page => this.repository.listWindows(job.id, page))) {
                if (keeper.stopping) break;
                if (window.status === 'skipped' || window.status === 'oversized') continue;
                const prior = await this.progress.snapshot(job.id, window);
                const task = this.windows.run(window, { job, lease, questions, expected: allIds, provider: provider!, keeper })
                    .catch(async error => {
                        await this.repository.updateWindow(lease, window.id, { status: 'failed', diagnostics: [...window.diagnostics, error instanceof Error ? error.message : 'Window failed'] });
                        throw error;
                    })
                    .finally(() => this.progress.settle(lease, job.id, window, progress, prior));
                // A fast failure can occur while the next page/read is awaited; attach a handler
                // immediately while retaining the original rejection for the batch drain below.
                void task.catch(() => {});
                pending.push(task);
                if (pending.length >= job.manifest.settings.concurrency) { await Promise.all(pending); pending = []; await keeper.beat(); }
            }
            await Promise.all(pending);
            if (keeper.leaseLost || signal?.aborted) return true; // Leave the lease recoverable after shutdown or loss.
            const counters = await this.progress.counters(job.id, allIds.length);
            await this.usage.finish(lease, await this.progress.finalStatus(job.id, counters, keeper.cancelling), counters);
        } catch (error) {
            keeper.abortAll();
            await Promise.allSettled(pending);
            if (!keeper.leaseLost && !signal?.aborted)
                await this.usage.fail(lease, () => this.progress.counters(job.id, job.manifest.codebook.definitions.filter(definition => definition.enabled && !definition.archived).length), error);
        } finally { keeper.stop(); }
        return true;
    }
}
