import type { AnalysisJob, JobLifecycleStore, Lease } from '@sidechannel/contracts/analysis/jev-repository';

export interface LeaseKeeperOptions { leaseMs: number; heartbeatMs: number }

/** The two job-lifecycle operations a lease needs; a full `AnalysisWorkerStore` satisfies it. */
export interface LeasePorts {
    heartbeat(lease: Lease, now: string, leaseMs: number): Promise<boolean>;
    getJob(id: string): Promise<Pick<AnalysisJob, 'id' | 'cancelRequested'> | null>;
}

/**
 * Owns one claimed lease: periodic heartbeat, cancellation observation and abort fan-out.
 * A lost lease is reported, never repaired; the worker leaves the job recoverable.
 */
export class LeaseKeeper {
    private readonly controllers = new Set<AbortController>();
    private readonly onAbort = () => this.abortAll();
    private readonly jobId: string;
    private lost = false;
    private cancelled: boolean;
    private heartbeating = false;
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly jobs: LeasePorts,
        private readonly lease: Lease,
        job: Pick<AnalysisJob, 'id' | 'cancelRequested'>,
        private readonly options: LeaseKeeperOptions,
        private readonly signal?: AbortSignal,
    ) {
        this.jobId = job.id;
        this.cancelled = job.cancelRequested;
    }

    /** True once this worker must stop scheduling new windows. */
    get stopping(): boolean { return this.lost || this.cancelled || this.signal?.aborted === true; }
    /** True when the lease was lost (as opposed to cancelled). */
    get leaseLost(): boolean { return this.lost; }
    get cancelling(): boolean { return this.cancelled; }

    register(controller: AbortController): void { this.controllers.add(controller); }
    release(controller: AbortController): void { this.controllers.delete(controller); }
    abortAll(): void { for (const controller of this.controllers) controller.abort(); }

    async beat(): Promise<void> {
        if (this.heartbeating) return;
        this.heartbeating = true;
        try {
            if (!await this.jobs.heartbeat(this.lease, new Date().toISOString(), this.options.leaseMs)) this.lost = true;
            const latest = await this.jobs.getJob(this.jobId);
            this.cancelled = Boolean(latest?.cancelRequested);
            if (this.lost || this.cancelled) this.abortAll();
        } catch { this.lost = true; this.abortAll(); }
        finally { this.heartbeating = false; }
    }

    start(): void {
        this.signal?.addEventListener('abort', this.onAbort, { once: true });
        this.timer = setInterval(() => void this.beat(), this.options.heartbeatMs);
        this.timer.unref();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.signal?.removeEventListener('abort', this.onAbort);
    }
}
