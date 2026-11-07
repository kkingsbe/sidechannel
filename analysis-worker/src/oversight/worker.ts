import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Repository } from '@sidechannel/contracts/harness/server';
import { allRecords } from '@sidechannel/domain/analysis/store';
import type { ResearchStore } from '@sidechannel/contracts/analysis/store';
import type { MonitorDefinition, MonitorEvaluation, MonitorJudgment, MonitorPreview, MonitorViewResult, Projection } from '@sidechannel/contracts/oversight/contracts';
import type { MonitorProvider } from '@sidechannel/contracts/oversight/server';
import { getMonitorPreview, OversightError } from '@sidechannel/domain/oversight/service';

const outputSchema = z.object({ judgments: z.array(z.object({ outcomeId: z.string(), verdict: z.enum(['present', 'absent', 'uncertain']),
    evidenceIds: z.array(z.string()), explanation: z.string().trim().min(1).max(20000) }).strict()) }).strict();

export function validateMonitorOutput(output: unknown, projection: Projection, definition: MonitorDefinition): MonitorJudgment[] {
    const { judgments } = outputSchema.parse(output), outcomes = definition.outcomes.filter(o => !o.archived);
    if (judgments.length !== outcomes.length || new Set(judgments.map(j => j.outcomeId)).size !== judgments.length || judgments.some(j => !outcomes.some(o => o.id === j.outcomeId)))
        throw new Error('Monitor must return exactly one judgment for every enabled outcome');
    const evidence = new Set(projection.evidenceIds);
    for (const judgment of judgments) {
        if (judgment.evidenceIds.some(id => !evidence.has(id))) throw new Error(`Unsupported evidence citation for ${judgment.outcomeId}`);
        if (judgment.verdict === 'present' && !judgment.evidenceIds.length) throw new Error(`Present finding for ${judgment.outcomeId} requires evidence citations`);
    }
    return judgments;
}

class LeaseLost extends Error {}

async function updateJob(store: ResearchStore, id: string, change: (job: MonitorEvaluation) => MonitorEvaluation, fence: { owner: string; ttl: number; initial?: boolean }) {
    for (let attempt = 0; attempt < 12; attempt++) {
        if (!await store.renew('monitor', id, fence.owner, fence.ttl)) throw new LeaseLost('Monitor lease lost');
        const current = await store.get<MonitorEvaluation>('monitor_evaluations', id);
        if (!current) throw new Error('Monitor job disappeared');
        if (!fence.initial && current.workerOwner !== fence.owner) throw new LeaseLost('Monitor ownership changed');
        const next = change(structuredClone(current));
        next.workerOwner = fence.owner;
        next.revision = current.revision + 1; next.updatedAt = new Date().toISOString();
        if (await store.replace('monitor_evaluations', id, current.revision, next)) return next;
    }
    throw new Error('Monitor job revision remained busy');
}

export async function processNextMonitorJob(_repository: Repository, store: ResearchStore, provider: MonitorProvider, workerId: string): Promise<boolean> {
    const candidates = (await allRecords<MonitorEvaluation>(store, 'monitor_evaluations')).filter(job => ['queued', 'running'].includes(job.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const candidate of candidates) {
        const ttl = Math.max(60000, candidate.settings.timeoutMs + 30000);
        const owner = `${workerId}:${randomUUID()}`, fence = { owner, ttl };
        if (!await store.claim('monitor', candidate.id, owner, ttl)) continue;
        let lostLease = false;
        const heartbeat = setInterval(() => { void store.renew('monitor', candidate.id, owner, ttl).then(ok => { if (!ok) lostLease = true; }).catch(() => { lostLease = true; }); }, Math.min(20000, ttl / 3));
        try {
            const claimed = await store.get<MonitorEvaluation>('monitor_evaluations', candidate.id);
            if (!claimed || !['queued', 'running'].includes(claimed.status)) continue;
            let preview: MonitorPreview | null;
            try { preview = await getMonitorPreview(store, candidate.previewId); }
            catch (error) {
                if (!(error instanceof OversightError)) throw error;
                await updateJob(store, candidate.id, job => ({ ...job,
                    status: job.results.some(result => result.status === 'completed') ? 'partial' : 'failed',
                    results: job.results.map(result => ['pending', 'running'].includes(result.status)
                        ? { ...result, status: 'failed', error: error.message } : result),
                }), { ...fence, initial: true });
                return true;
            }
            if (!preview) {
                await updateJob(store, candidate.id, job => ({ ...job, status: 'failed', results: job.results.map(result => ({ ...result, status: 'failed', error: 'Frozen preview is missing' })) }), { ...fence, initial: true });
                return true;
            }
            await updateJob(store, candidate.id, job => ({ ...job, status: 'running', results: job.results.map(result => result.status === 'running'
                ? { ...result, status: 'failed', error: 'Previous worker stopped during this invocation. No automatic repeat was made.' } : result) }), { ...fence, initial: true });
            for (const source of preview.runs) for (const projection of source.projections) {
                if (lostLease) throw new LeaseLost('Monitor lease lost; stopped recording results');
                const current = (await store.get<MonitorEvaluation>('monitor_evaluations', candidate.id))!;
                if (current.cancelRequested) break;
                const result = current.results.find(r => r.runId === source.runId && r.view === projection.view)!;
                if (result.status !== 'pending') continue;
                await updateJob(store, candidate.id, job => ({ ...job, results: job.results.map(r => r.runId === source.runId && r.view === projection.view ? { ...r, status: 'running' } : r) }), fence);
                const started = Date.now(); let finished: MonitorViewResult;
                try {
                    const response = await provider.evaluate({ evaluationId: candidate.id, projection, definition: preview.definition, settings: preview.settings });
                    finished = { ...result, status: 'completed', judgments: validateMonitorOutput(response.output, projection, preview.definition), durationMs: Date.now() - started, usage: response.usage };
                } catch (error) {
                    finished = { ...result, status: 'failed', judgments: [], durationMs: Date.now() - started, error: error instanceof Error ? error.message : 'Monitor invocation failed' };
                }
                if (lostLease) throw new LeaseLost('Monitor lease lost; stopped recording results');
                await updateJob(store, candidate.id, job => ({ ...job, results: job.results.map(r => r.runId === source.runId && r.view === projection.view ? finished : r) }), fence);
            }
            await updateJob(store, candidate.id, job => {
                if (job.cancelRequested) return { ...job, status: 'cancelled', results: job.results.map(r => r.status === 'pending' ? { ...r, status: 'cancelled' } : r) };
                const completed = job.results.filter(r => r.status === 'completed').length;
                return { ...job, status: completed === job.results.length ? 'completed' : completed > 0 || job.results.some(r => r.status === 'oversized') ? 'partial' : 'failed' };
            }, fence);
            return true;
        } catch (error) {
            if (!(error instanceof LeaseLost)) throw error;
            return true; // Another owner will recover; never terminate the shared worker loop.
        } finally { clearInterval(heartbeat); await store.release('monitor', candidate.id, owner); }
    }
    return false;
}