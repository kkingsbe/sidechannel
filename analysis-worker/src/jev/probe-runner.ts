import { computeReliability } from '@sidechannel/domain/analysis/jev-probe';
import { pages } from '@sidechannel/domain/analysis/jev-service';
import type { AnalysisReliability, AnalysisResult, JobLifecycleStore, ResultStore, WindowStore } from '@sidechannel/contracts/analysis/jev-repository';
import { WindowRunner, type WindowPorts, type WindowRun } from './window-runner.js';

export interface ProbePorts extends WindowPorts, Pick<JobLifecycleStore, 'setReliability'>, Pick<ResultStore, 'listResults'>, Pick<WindowStore, 'getWindow'> {}

/**
 * The reliability probe (spec section 6): after the main pass, re-scores the manifest's probe windows the configured
 * number of times, stores the answers flagged `probe: true` beside (never over) the primaries, and writes the
 * repeat-variance summary to the job. Only completed windows are probed; failures cost samples, not the analysis.
 */
export class ProbeRunner {
    private readonly windows: WindowRunner;
    constructor(private readonly repository: ProbePorts) { this.windows = new WindowRunner(repository); }

    async run(run: WindowRun): Promise<AnalysisReliability | undefined> {
        const { job, lease, keeper } = run, probe = job.manifest.settings.probe, ids = job.manifest.probeWindowIds ?? [];
        if (!probe || !ids.length || keeper.stopping) return undefined;
        const concurrency = job.manifest.settings.concurrency;
        for (let start = 0; start < ids.length && !keeper.stopping; start += concurrency) {
            await Promise.all(ids.slice(start, start + concurrency).map(async id => {
                const window = await this.repository.getWindow(job.id, id);
                // Probe failures never fail the analysis: a window that cannot be re-scored simply contributes no samples.
                if (window?.status === 'completed') await this.windows.probe(window, run, probe.repeats).catch(() => undefined);
            }));
            await keeper.beat();
        }
        if (keeper.stopping) return undefined;
        const results: AnalysisResult[] = [];
        for await (const result of pages(page => this.repository.listResults(job.id, { ...page, probe: 'only' }))) results.push(result);
        const reliability = computeReliability(results, probe.repeats, new Date().toISOString());
        return await this.repository.setReliability(lease, reliability) ? reliability : undefined;
    }
}
