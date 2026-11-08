import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { EventSink } from './event-recorder.js';

export interface RunTerminationOptions {
    run: Run;
    recorder: EventSink;
}

/**
 * Terminal state machine: the cancelled/interrupted/failed taxonomy, best-effort
 * missing-report and turn-close events, and the final persistence attempt.
 *
 * Every emission stays inside the original swallow-all guard: evidence loss during
 * termination must not erase the status that was already decided. Call sites and order
 * are unchanged from the `catch` block of `HarnessScheduler.run()`.
 */
export class RunTermination {
    /** Mirrors the loop's `activeTurn` flag so an aborted turn still closes with `turn_ended`. */
    activeTurn = false;
    constructor(private readonly options: RunTerminationOptions) { }

    async terminate(error: unknown): Promise<void> {
        const { run, recorder } = this.options;
        const message = error instanceof Error ? error.message : String(error);
        const reporting = run.status === 'reporting';
        run.status = message === 'CANCELLED' ? 'cancelled' : recorder.evidenceFailed ? 'interrupted' : 'failed';
        run.failureReason = message;
        try {
            if (!recorder.evidenceFailed && reporting)
                for (const role of run.config.roles.filter(role => !run.reports.some(report => report.agentId === role.id)))
                    await recorder.emit('report_missing', { reason: message, phase: 'report' }, { agentId: role.id });
            if (!recorder.evidenceFailed && this.activeTurn)
                await recorder.emit('turn_ended', { reason: message === 'CANCELLED' ? 'cancelled' : 'error', error: message });
            if (!recorder.evidenceFailed)
                await recorder.emit('run_terminated', { status: run.status, reason: message });
        }
        catch { }
        if (recorder.evidenceFailed)
            run.status = 'interrupted';
        run.activeAgentId = undefined;
        try {
            await recorder.persist();
        }
        catch { }
    }
}
