import { randomUUID } from 'node:crypto';
import type { SerializedWindow } from '@sidechannel/contracts/analysis/evidence-contracts';
import { buildSystemOnePayload } from '@sidechannel/domain/analysis/jev-questions';
import { JevProviderError, type JevProvider, type JevQuestion, type JsonValue } from '@sidechannel/contracts/analysis/jev-provider';
import type { AnalysisAttempt, AnalysisJob, AnalysisResult, ArtifactStore, Lease, ResultStore, WindowRecord, WindowStore } from '@sidechannel/contracts/analysis/jev-repository';
import type { LeaseKeeper } from './lease-keeper.js';

export interface WindowPorts extends WindowStore, ResultStore, ArtifactStore {}

export interface WindowRun { job: AnalysisJob; lease: Lease; questions: JevQuestion[]; expected: string[]; provider: JevProvider; keeper: LeaseKeeper }

/** One window's provider batches: fenced attempts, immutable request/response artifacts, partial answers preserved. */
export class WindowRunner {
    constructor(private readonly repository: WindowPorts) {}

    async run(window: WindowRecord, run: WindowRun): Promise<void> {
        const { job, lease, questions, expected, provider, keeper } = run;
        const existing = await this.repository.listResults(job.id, { windowId: window.id, limit: 100 });
        const completed = new Set(existing.items.map(result => result.codeId));
        if (expected.every(id => completed.has(id))) { await this.repository.updateWindow(lease, window.id, { status: 'completed' }); return; }
        if (keeper.stopping) return;
        if (!await this.repository.updateWindow(lease, window.id, { status: 'running' })) return;
        const serialized = await this.repository.readArtifact<SerializedWindow>(window.inputRef);
        const batches = window.batches.length ? window.batches : [expected];
        const failures: string[] = [];
        let contextRejected = false;
        for (const batch of batches) {
            let failure = '';
            if (keeper.stopping) break;
            const wanted = questions.filter(question => batch.includes(question.codeId) && !completed.has(question.codeId));
            if (!wanted.length) continue;
            const controller = new AbortController();
            keeper.register(controller);
            const id = randomUUID(), requestRef = job.id + ':request:' + id;
            const request = { state: serialized.state as JsonValue, model: job.manifest.settings.model, questions: wanted };
            await this.repository.putArtifact(requestRef, { ...request, systemOne: buildSystemOnePayload(request) });
            const attempt: AnalysisAttempt = { id, jobId: job.id, windowId: window.id, codeIds: wanted.map(question => question.codeId),
                requestRef, startedAt: new Date().toISOString(), status: 'running', requestedModel: request.model };
            if (!await this.repository.startAttempt(lease, attempt)) { keeper.release(controller); return; }
            // Provider owns the finite retry budget. This outer deadline bounds faulty injected transports too.
            const settings = job.manifest.settings;
            const totalDeadline = settings.timeoutMs * settings.maxAttempts + settings.retryBaseMs * (2 ** settings.maxAttempts);
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const response = await Promise.race([
                    provider.classify({ ...request, signal: controller.signal }),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Provider request exceeded the frozen retry/timeout budget')); }, totalDeadline); }),
                ]);
                const responseRef = job.id + ':response:' + id;
                await this.repository.putArtifact(responseRef, response);
                const results: AnalysisResult[] = [], seen = new Set<string>();
                let badKeys = false;
                for (const answer of response.answers) {
                    if (!wanted.some(question => question.codeId === answer.codeId) || seen.has(answer.codeId)) { failure = 'Unexpected or duplicate provider response key'; badKeys = true; continue; }
                    seen.add(answer.codeId);
                    if (typeof answer.probability !== 'number' || !Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) { failure = answer.error?.message ?? 'Missing or malformed answer'; continue; }
                    results.push({ id: randomUUID(), jobId: job.id, windowId: window.id, codeId: answer.codeId, probability: answer.probability, attemptId: id, createdAt: new Date().toISOString() });
                }
                if (seen.size !== wanted.length) failure = 'Provider omitted one or more requested answers';
                if (badKeys) results.length = 0;
                const finished = { ...attempt, status: results.length === wanted.length ? 'succeeded' as const : 'failed' as const,
                    finishedAt: new Date().toISOString(), responseRef, returnedModel: response.returnedModel, usage: response.usage, ...(failure ? { error: failure } : {}) };
                if (await this.repository.finishAttempt(lease, finished, results)) for (const result of results) completed.add(result.codeId);
            } catch (error) {
                failure = error instanceof Error ? error.message : 'Provider failed';
                const responseRef = job.id + ':response:' + id;
                contextRejected = error instanceof JevProviderError && error.failure.kind === 'context';
                await this.repository.putArtifact(responseRef, error instanceof JevProviderError ? { failure: error.failure, attempts: error.attempts } : { error: failure });
                await this.repository.finishAttempt(lease, { ...attempt, status: 'failed', finishedAt: new Date().toISOString(), responseRef, error: failure }, []);
            } finally { if (timer) clearTimeout(timer); keeper.release(controller); if (failure) failures.push(failure); }
            if (contextRejected) break;
        }
        await this.repository.updateWindow(lease, window.id, { status: expected.every(id => completed.has(id)) ? 'completed' : contextRejected ? 'oversized' : 'failed',
            diagnostics: [...window.diagnostics, ...failures] });
    }
}
