import { randomUUID } from 'node:crypto';
import type { SerializedWindow } from '@sidechannel/contracts/analysis/evidence-contracts';
import { buildSystemOnePayload, shuffleChoiceOptions } from '@sidechannel/domain/analysis/jev-questions';
import { JevProviderError, questionKey, type JevProvider, type JevQuestion, type JsonValue } from '@sidechannel/contracts/analysis/jev-provider';
import type { AnalysisAttempt, AnalysisJob, AnalysisResult, ArtifactStore, Lease, ResultStore, WindowRecord, WindowStore } from '@sidechannel/contracts/analysis/jev-repository';
import { pages } from '@sidechannel/domain/analysis/jev-service';
import type { LeaseKeeper } from './lease-keeper.js';

export interface WindowPorts extends WindowStore, ResultStore, ArtifactStore {}

/**
 * `questionsFor` rebuilds the questions a window's serialized input implies (actor-scoped codes expand to its active
 * agents), exactly as the preview did. `forbiddenText` is handed to the request builder as its last-line leak check.
 */
export interface WindowRun { job: AnalysisJob; lease: Lease; questionsFor(serialized: SerializedWindow): JevQuestion[]; forbiddenText: string[]; provider: JevProvider; keeper: LeaseKeeper }

/** One pass over a window's batches: which questions still need an answer, and whether the pass is a probe repeat. */
interface Pass { pending(key: string): boolean; done(key: string): void; probe: boolean; }

/** One window's provider batches: fenced attempts, immutable request/response artifacts, partial answers preserved. */
export class WindowRunner {
    constructor(private readonly repository: WindowPorts) {}

    async run(window: WindowRecord, run: WindowRun): Promise<void> {
        const { job, lease, keeper } = run;
        const existing: AnalysisResult[] = [];
        for await (const result of pages(page => this.repository.listResults(job.id, { ...page, windowId: window.id }))) existing.push(result);
        const completed = new Set(existing.map(questionKey));
        const serialized = await this.repository.readArtifact<SerializedWindow>(window.inputRef);
        const questions = run.questionsFor(serialized), expected = questions.map(questionKey);
        if (expected.every(key => completed.has(key))) { await this.repository.updateWindow(lease, window.id, { status: 'completed' }); return; }
        if (keeper.stopping) return;
        if (!await this.repository.updateWindow(lease, window.id, { status: 'running' })) return;
        const { failures, contextRejected } = await this.pass(window, serialized, questions, run, { pending: key => !completed.has(key), done: key => { completed.add(key); }, probe: false });
        await this.repository.updateWindow(lease, window.id, { status: expected.every(key => completed.has(key)) ? 'completed' : contextRejected ? 'oversized' : 'failed',
            diagnostics: [...window.diagnostics, ...failures] });
    }

    /**
     * Re-scores a completed window `repeats` times for the reliability probe (spec section 6). Probe attempts and
     * results are flagged and stored beside the primaries; the window's status and primary results are never touched.
     * Resumable: a question that already has `r + 1` probe results skips repeat `r`.
     */
    async probe(window: WindowRecord, run: WindowRun, repeats: number): Promise<void> {
        const { job } = run;
        const counts = new Map<string, number>();
        for await (const result of pages(page => this.repository.listResults(job.id, { ...page, windowId: window.id, probe: 'only' }))) counts.set(questionKey(result), (counts.get(questionKey(result)) ?? 0) + 1);
        const serialized = await this.repository.readArtifact<SerializedWindow>(window.inputRef);
        const questions = run.questionsFor(serialized);
        for (let repeat = 0; repeat < repeats && !run.keeper.stopping; repeat++) {
            const { contextRejected } = await this.pass(window, serialized, questions, run, { pending: key => (counts.get(key) ?? 0) <= repeat, done: key => { counts.set(key, (counts.get(key) ?? 0) + 1); }, probe: true });
            if (contextRejected) return;
        }
    }

    private async pass(window: WindowRecord, serialized: SerializedWindow, questions: JevQuestion[], run: WindowRun, pass: Pass): Promise<{ failures: string[]; contextRejected: boolean }> {
        const { job, lease, provider, keeper } = run;
        const batches = window.batches.length ? window.batches : [questions.map(questionKey)];
        const failures: string[] = [];
        let contextRejected = false;
        for (const batch of batches) {
            let failure = '';
            if (keeper.stopping) break;
            const pending = questions.filter(question => batch.includes(questionKey(question)) && pass.pending(questionKey(question)));
            if (!pending.length) continue;
            const id = randomUUID(), requestRef = job.id + ':request:' + id;
            // A fresh shuffle seed per request: Jev leans toward the first choice option, and repeats should not share an order.
            const shuffleSeed = id;
            let wanted: JevQuestion[], request: { state: JsonValue; model: string; questions: JevQuestion[]; shuffleSeed: string }, systemOne: ReturnType<typeof buildSystemOnePayload>;
            try {
                wanted = shuffleChoiceOptions(pending, shuffleSeed);
                request = { state: serialized.state as JsonValue, model: job.manifest.settings.model, questions: wanted, shuffleSeed };
                systemOne = buildSystemOnePayload({ ...request, forbiddenText: run.forbiddenText });
            } catch (error) {
                // A request that cannot be built (including a condition-text leak) is never sent.
                failures.push(error instanceof Error ? error.message : 'Request could not be built');
                continue;
            }
            const controller = new AbortController();
            keeper.register(controller);
            // The artifact is the exact request minus forbiddenText: the condition text must not be persisted in it either.
            await this.repository.putArtifact(requestRef, { ...request, systemOne });
            const attempt: AnalysisAttempt = { id, jobId: job.id, windowId: window.id, codeIds: wanted.map(questionKey),
                requestRef, startedAt: new Date().toISOString(), status: 'running', requestedModel: request.model, ...(pass.probe ? { probe: true } : {}) };
            if (!await this.repository.startAttempt(lease, attempt)) { keeper.release(controller); return { failures, contextRejected }; }
            // Provider owns the finite retry budget. This outer deadline bounds faulty injected transports too.
            const settings = job.manifest.settings;
            const totalDeadline = settings.timeoutMs * settings.maxAttempts + settings.retryBaseMs * (2 ** settings.maxAttempts);
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const response = await Promise.race([
                    provider.classify({ ...request, forbiddenText: run.forbiddenText, signal: controller.signal }),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Provider request exceeded the frozen retry/timeout budget')); }, totalDeadline); }),
                ]);
                const responseRef = job.id + ':response:' + id;
                await this.repository.putArtifact(responseRef, response);
                const results: AnalysisResult[] = [], seen = new Set<string>();
                let badKeys = false;
                for (const answer of response.answers) {
                    const key = questionKey(answer), question = wanted.find(candidate => questionKey(candidate) === key);
                    if (!question || seen.has(key)) { failure = 'Unexpected or duplicate provider response key'; badKeys = true; continue; }
                    seen.add(key);
                    const typed = answer.answer, type = question.type ?? 'noul';
                    // A noul answer needs a probability in range; choice and score answers need their typed payload and no probability.
                    const valid = typed ? typed.type === type && (typed.type !== 'noul' || answer.probability === typed.probability) : type === 'noul' && typeof answer.probability === 'number';
                    if (!valid || answer.probability !== null && (typeof answer.probability !== 'number' || !Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1)) { failure = answer.error?.message ?? 'Missing or malformed answer'; continue; }
                    results.push({ id: randomUUID(), jobId: job.id, windowId: window.id, codeId: question.codeId, ...(question.actorId ? { actorId: question.actorId } : {}),
                        probability: type === 'noul' ? answer.probability : null, answer: typed ?? { type: 'noul', probability: answer.probability! },
                        ...(pass.probe ? { probe: true } : {}), attemptId: id, createdAt: new Date().toISOString() });
                }
                if (seen.size !== wanted.length) failure = 'Provider omitted one or more requested answers';
                if (badKeys) results.length = 0;
                const finished = { ...attempt, status: results.length === wanted.length ? 'succeeded' as const : 'failed' as const,
                    finishedAt: new Date().toISOString(), responseRef, returnedModel: response.returnedModel, usage: response.usage, ...(failure ? { error: failure } : {}) };
                if (await this.repository.finishAttempt(lease, finished, results)) for (const result of results) pass.done(questionKey(result));
            } catch (error) {
                failure = error instanceof Error ? error.message : 'Provider failed';
                const responseRef = job.id + ':response:' + id;
                contextRejected = error instanceof JevProviderError && error.failure.kind === 'context';
                await this.repository.putArtifact(responseRef, error instanceof JevProviderError ? { failure: error.failure, attempts: error.attempts } : { error: failure });
                await this.repository.finishAttempt(lease, { ...attempt, status: 'failed', finishedAt: new Date().toISOString(), responseRef, error: failure }, []);
            } finally { if (timer) clearTimeout(timer); keeper.release(controller); if (failure) failures.push(failure); }
            if (contextRejected) break;
        }
        return { failures, contextRejected };
    }
}
