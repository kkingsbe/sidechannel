import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AnalysisConfiguration, SerializedWindow } from '@sidechannel/contracts/analysis/evidence-contracts';
import { buildBehaviorQuestions, buildSystemOnePayload } from '@sidechannel/domain/analysis/jev-questions';
import { JevProviderError, type JevProvider, type JevQuestion, type JsonValue } from '@sidechannel/contracts/analysis/jev-provider';
import { TypeSafeJevProvider } from './jev-provider.js';
import { emptyCounters } from '@sidechannel/domain/analysis/jev-repository';
import type { AnalysisAttempt, AnalysisJob, AnalysisResult, AnalysisWorkerStore, JobCounters, JobUsage, Lease, WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';
import { pages } from '@sidechannel/domain/analysis/jev-service';

export interface AnalysisWorkerOptions { owner?: string; leaseMs?: number; heartbeatMs?: number; provider?: JevProvider; providerFactory?: (settings: AnalysisConfiguration) => JevProvider; }

/** Owns analysis leases only. Never invokes or mutates the experiment scheduler. */
export class AnalysisWorker {
    private readonly owner: string; private readonly leaseMs: number; private readonly heartbeatMs: number;
    constructor(private readonly repository: AnalysisWorkerStore, private readonly options: AnalysisWorkerOptions = {}) {
        this.owner = options.owner ?? randomUUID(); this.leaseMs = options.leaseMs ?? 30_000; this.heartbeatMs = options.heartbeatMs ?? Math.floor(this.leaseMs / 3);
        if (this.leaseMs < 100 || this.heartbeatMs < 10 || this.heartbeatMs >= this.leaseMs) throw new Error('Heartbeat must be shorter than a positive lease');
    }
    async run(signal: AbortSignal) { while (!signal.aborted) { if (!await this.runOnce(signal)) try { await delay(500, undefined, { signal }); } catch {} } }
    async runOnce(signal?: AbortSignal): Promise<boolean> {
        const claimed = await this.repository.claim(this.owner, new Date().toISOString(), this.leaseMs); if (!claimed) return false;
        const { job, lease } = claimed, settings = job.manifest.settings;
        let provider: JevProvider | undefined;
        let pending: Promise<void>[] = [];
        const controllers = new Set<AbortController>(); let lost = false, cancelled = job.cancelRequested, heartbeating = false;
        const abortAll = () => { for (const c of controllers) c.abort(); }; signal?.addEventListener('abort', abortAll, { once: true });
        const beat = async () => { if (heartbeating) return; heartbeating = true; try { if (!await this.repository.heartbeat(lease, new Date().toISOString(), this.leaseMs)) lost = true; const latest = await this.repository.getJob(job.id); cancelled = Boolean(latest?.cancelRequested); if (lost || cancelled) abortAll(); } catch { lost = true; abortAll(); } finally { heartbeating = false; } };
        const timer = setInterval(() => void beat(), this.heartbeatMs); timer.unref();
        try {
            if (!cancelled) provider = this.options.provider ?? this.options.providerFactory?.(settings) ?? new TypeSafeJevProvider({ timeoutMs: settings.timeoutMs, maxAttempts: settings.maxAttempts, retryBaseMs: settings.retryBaseMs });
            // A crash can leave an attempt open; record recovery rather than treating it as a negative answer.
            for await (const a of pages(p => this.repository.listAttempts(job.id, p))) if (a.status === 'running') await this.repository.finishAttempt(lease, { ...a, status: 'failed', finishedAt: new Date().toISOString(), error: 'Previous worker lease expired before this attempt was committed; provider completion and cost may be unknown' }, []);
            const questions = buildBehaviorQuestions(job.manifest.codebook.definitions), allIds = questions.map(q => q.codeId);
            const progress = await this.counters(job.id, allIds.length);
            for await (const window of pages(p => this.repository.listWindows(job.id, p))) {
                if (lost || cancelled || signal?.aborted) break;
                if (window.status === 'skipped' || window.status === 'oversized') continue;
                const priorAnswers = (await this.repository.listResults(job.id, { windowId: window.id, limit: 100 })).items.length;
                const priorSubmitted = (await this.repository.listAttempts(job.id, { windowId: window.id, limit: 1 })).items.length > 0;
                const task = this.processWindow(job, lease, window, questions, allIds, provider!, controllers, () => lost || cancelled || Boolean(signal?.aborted)).catch(async e => { await this.repository.updateWindow(lease, window.id, { status: 'failed', diagnostics: [...window.diagnostics, e instanceof Error ? e.message : 'Window failed'] }); throw e; }).finally(async () => {
                    const latest = await this.repository.getWindow(job.id, window.id);
                    if (!latest) return;
                    const answers = (await this.repository.listResults(job.id, { windowId: window.id, limit: 100 })).items.length;
                    const submitted = (await this.repository.listAttempts(job.id, { windowId: window.id, limit: 1 })).items.length > 0;
                    progress.returnedAnswers += answers - priorAnswers; progress.submittedWindows += Number(submitted) - Number(priorSubmitted);
                    progress.finishedWindows += Number(latest.status === 'completed') - Number(window.status === 'completed');
                    progress.failedWindows += Number(latest.status === 'failed' || latest.status === 'oversized') - Number(window.status === 'failed');
                    // Per-window deltas keep progress linear. Full history/usage reconciliation runs once at finalization.
                    await this.repository.updateCounters(lease, { ...progress });
                });
                // A fast failure can occur while the next page/read is awaited; attach a handler
                // immediately while retaining the original rejection for the batch drain below.
                void task.catch(() => {});
                pending.push(task);
                if (pending.length >= settings.concurrency) { await Promise.all(pending); pending = []; await beat(); }
            }
            await Promise.all(pending);
            if (lost || signal?.aborted) return true; // Leave lease recoverable after process shutdown or loss.
            const counters = await this.counters(job.id, allIds.length);
            const status = cancelled ? 'cancelled' : counters.returnedAnswers === counters.expectedAnswers && counters.failedWindows === 0 ? 'completed' : counters.returnedAnswers ? 'partial' : 'failed';
            await this.repository.finishJob(lease, status, counters, undefined, await this.usage(job.id));
        } catch (e) {
            abortAll(); await Promise.allSettled(pending);
            if (!lost && !signal?.aborted) { const c = await this.counters(job.id, job.manifest.codebook.definitions.filter(d => d.enabled && !d.archived).length); await this.repository.finishJob(lease, c.returnedAnswers ? 'partial' : 'failed', c, e instanceof Error ? e.message : 'Analysis worker failed', await this.usage(job.id)); }
        } finally { clearInterval(timer); signal?.removeEventListener('abort', abortAll); }
        return true;
    }
    private async processWindow(job: AnalysisJob, lease: Lease, window: WindowRecord, questions: JevQuestion[], expected: string[], provider: JevProvider, controllers: Set<AbortController>, stopping: () => boolean) {
        const existing = await this.repository.listResults(job.id, { windowId: window.id, limit: 100 });
        const completed = new Set(existing.items.map(r => r.codeId)); if (expected.every(id => completed.has(id))) { await this.repository.updateWindow(lease, window.id, { status: 'completed' }); return; }
        if (stopping()) return;
        if (!await this.repository.updateWindow(lease, window.id, { status: 'running' })) return;
        const serialized = await this.repository.readArtifact<SerializedWindow>(window.inputRef);
        const batches = window.batches.length ? window.batches : [expected]; const failures: string[] = []; let contextRejected = false;
        for (const batch of batches) {
            let failure = '';
            if (stopping()) break;
            const wanted = questions.filter(q => batch.includes(q.codeId) && !completed.has(q.codeId)); if (!wanted.length) continue;
            const controller = new AbortController(); controllers.add(controller); const id = randomUUID(), requestRef = job.id + ':request:' + id;
            const request = { state: serialized.state as JsonValue, model: job.manifest.settings.model, questions: wanted };
            await this.repository.putArtifact(requestRef, { ...request, systemOne: buildSystemOnePayload(request) });
            const attempt: AnalysisAttempt = { id, jobId: job.id, windowId: window.id, codeIds: wanted.map(q => q.codeId), requestRef, startedAt: new Date().toISOString(), status: 'running', requestedModel: request.model };
            if (!await this.repository.startAttempt(lease, attempt)) { controllers.delete(controller); return; }
            // Provider owns the finite retry budget. This outer deadline bounds faulty injected transports too.
            const s = job.manifest.settings, totalDeadline = s.timeoutMs * s.maxAttempts + s.retryBaseMs * (2 ** s.maxAttempts);
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const response = await Promise.race([provider.classify({ ...request, signal: controller.signal }), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Provider request exceeded the frozen retry/timeout budget')); }, totalDeadline); })]);
                const responseRef = job.id + ':response:' + id; await this.repository.putArtifact(responseRef, response);
                const results: AnalysisResult[] = []; const seen = new Set<string>(); let badKeys = false;
                for (const answer of response.answers) { if (!wanted.some(q => q.codeId === answer.codeId) || seen.has(answer.codeId)) { failure = 'Unexpected or duplicate provider response key'; badKeys = true; continue; } seen.add(answer.codeId);
                    if (typeof answer.probability !== 'number' || !Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) { failure = answer.error?.message ?? 'Missing or malformed answer'; continue; }
                    results.push({ id: randomUUID(), jobId: job.id, windowId: window.id, codeId: answer.codeId, probability: answer.probability, attemptId: id, createdAt: new Date().toISOString() }); }
                if (seen.size !== wanted.length) failure = 'Provider omitted one or more requested answers';
                if (badKeys) results.length = 0;
                const finished = { ...attempt, status: results.length === wanted.length ? 'succeeded' as const : 'failed' as const, finishedAt: new Date().toISOString(), responseRef, returnedModel: response.returnedModel, usage: response.usage, ...(failure ? { error: failure } : {}) };
                if (await this.repository.finishAttempt(lease, finished, results)) for (const r of results) completed.add(r.codeId);
            } catch (e) { failure = e instanceof Error ? e.message : 'Provider failed'; const responseRef = job.id + ':response:' + id;
                contextRejected = e instanceof JevProviderError && e.failure.kind === 'context';
                await this.repository.putArtifact(responseRef, e instanceof JevProviderError ? { failure: e.failure, attempts: e.attempts } : { error: failure });
                await this.repository.finishAttempt(lease, { ...attempt, status: 'failed', finishedAt: new Date().toISOString(), responseRef, error: failure }, []);
            } finally { if (timer) clearTimeout(timer); controllers.delete(controller); if (failure) failures.push(failure); }
            if (contextRejected) break;
        }
        await this.repository.updateWindow(lease, window.id, { status: expected.every(id => completed.has(id)) ? 'completed' : contextRejected ? 'oversized' : 'failed', diagnostics: [...window.diagnostics, ...failures] });
    }
    private async counters(id: string, codeCount: number): Promise<JobCounters> {
        const c = emptyCounters(), submitted = new Set<string>();
        for await (const w of pages(p => this.repository.listWindows(id, p))) { c.preparedWindows++; if (w.status !== 'skipped') c.expectedAnswers += codeCount; if (w.status === 'completed') c.finishedWindows++; if (w.status === 'failed' || w.status === 'oversized') c.failedWindows++; if (w.status === 'skipped') c.skippedWindows++; }
        for await (const a of pages(p => this.repository.listAttempts(id, p))) submitted.add(a.windowId); c.submittedWindows = submitted.size;
        for await (const _r of pages(p => this.repository.listResults(id, p))) c.returnedAnswers++;
        return c;
    }
    private async usage(id: string): Promise<JobUsage> {
        const total: JobUsage = { inputTokens: 0, outputTokens: 0, knownInputTokens: 0, knownOutputTokens: 0, providerAttempts: 0, unresolvedAttempts: 0 };
        for await (const attempt of pages(p => this.repository.listAttempts(id, p))) {
            const response = attempt.responseRef ? await this.repository.readArtifact<{ attempts?: { usage?: { inputTokens?: unknown; outputTokens?: unknown } }[]; usage?: { inputTokens?: unknown; outputTokens?: unknown } }>(attempt.responseRef) : undefined;
            // The top-level usage repeats the final internal attempt. Count internal records exclusively when supplied.
            const records = response?.attempts?.length ? response.attempts : [{ usage: response?.usage ?? attempt.usage }];
            for (const record of records) {
                total.providerAttempts++; const input = record.usage?.inputTokens, output = record.usage?.outputTokens;
                const knownInput = typeof input === 'number' && Number.isFinite(input) && input >= 0, knownOutput = typeof output === 'number' && Number.isFinite(output) && output >= 0;
                if (knownInput) { total.knownInputTokens += input; if (total.inputTokens !== null) total.inputTokens += input; } else total.inputTokens = null;
                if (knownOutput) { total.knownOutputTokens += output; if (total.outputTokens !== null) total.outputTokens += output; } else total.outputTokens = null;
                if (!knownInput || !knownOutput) total.unresolvedAttempts++;
            }
        }
        return total;
    }
}