import { pages } from '@sidechannel/domain/analysis/jev-service';
import type { ArtifactStore, JobCounters, JobLifecycleStore, JobStatus, JobUsage, Lease, ResultStore } from '@sidechannel/contracts/analysis/jev-repository';

export interface UsagePorts extends Pick<JobLifecycleStore, 'finishJob'>, Pick<ResultStore, 'listAttempts'>, Pick<ArtifactStore, 'readArtifact'> {}

interface UsageRecord { usage?: { inputTokens?: unknown; outputTokens?: unknown } }
interface UsageResponse { attempts?: UsageRecord[]; usage?: { inputTokens?: unknown; outputTokens?: unknown } }

/** Final accounting: every provider attempt counted once, unknown usage preserved with known subtotals. */
export class UsageReconciler {
    constructor(private readonly repository: UsagePorts) {}

    async usage(jobId: string): Promise<JobUsage> {
        const total: JobUsage = { inputTokens: 0, outputTokens: 0, knownInputTokens: 0, knownOutputTokens: 0, providerAttempts: 0, unresolvedAttempts: 0 };
        for await (const attempt of pages(page => this.repository.listAttempts(jobId, { ...page, probe: 'include' }))) {
            const response = attempt.responseRef ? await this.repository.readArtifact<UsageResponse>(attempt.responseRef) : undefined;
            // The top-level usage repeats the final internal attempt. Count internal records exclusively when supplied.
            const records = response?.attempts?.length ? response.attempts : [{ usage: response?.usage ?? attempt.usage }];
            for (const record of records) {
                total.providerAttempts++;
                const input = record.usage?.inputTokens, output = record.usage?.outputTokens;
                const knownInput = typeof input === 'number' && Number.isFinite(input) && input >= 0;
                const knownOutput = typeof output === 'number' && Number.isFinite(output) && output >= 0;
                if (knownInput) { total.knownInputTokens += input; if (total.inputTokens !== null) total.inputTokens += input; } else total.inputTokens = null;
                if (knownOutput) { total.knownOutputTokens += output; if (total.outputTokens !== null) total.outputTokens += output; } else total.outputTokens = null;
                if (!knownInput || !knownOutput) total.unresolvedAttempts++;
            }
        }
        return total;
    }

    async finish(lease: Lease, status: JobStatus, counters: JobCounters): Promise<boolean> {
        return this.repository.finishJob(lease, status, counters, undefined, await this.usage(lease.jobId));
    }

    async fail(lease: Lease, counters: () => Promise<JobCounters>, error: unknown): Promise<boolean> {
        const counted = await counters();
        return this.repository.finishJob(lease, counted.returnedAnswers ? 'partial' : 'failed', counted,
            error instanceof Error ? error.message : 'Analysis worker failed', await this.usage(lease.jobId));
    }
}
