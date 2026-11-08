import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { EventLog, RunStateStore } from '@sidechannel/contracts/harness/server';

/** The surface every collaborator may use; `RunTermination` and the tests take only this. */
export interface EventSink {
    readonly evidenceFailed: boolean;
    emit(type: string, data: unknown, extra?: Partial<NewEvent>): Promise<HarnessEvent>;
    persist(): Promise<void>;
}

export interface EventRecorderOptions {
    run: Run;
    runId: string;
    runState: RunStateStore;
    events: EventLog;
}

/**
 * Owns event emission, the evidence-failure latch and the persistence cadence.
 *
 * `emit` stamps the run's current agent/round/turn; `persist` stamps `updatedAt` and saves the
 * run. Both set the latch and rethrow when the store fails — that latch is what turns a failed
 * run into `interrupted` instead of `failed`. `guard` applies the same latch to private-memory
 * writes. Behaviour, ordering and call sites are unchanged from `HarnessScheduler.run()`.
 */
export class EventRecorder implements EventSink {
    private failed = false;
    constructor(private readonly options: EventRecorderOptions) { }

    get evidenceFailed(): boolean { return this.failed; }

    async emit(type: string, data: unknown, extra: Partial<NewEvent> = {}): Promise<HarnessEvent> {
        const { run, runId, events } = this.options;
        try {
            return await events.appendEvent({ runId, type, data, agentId: run.activeAgentId, round: run.round, turn: run.turn, ...extra });
        }
        catch (error) {
            this.failed = true;
            throw error;
        }
    }

    async persist(): Promise<void> {
        const { run, runState } = this.options;
        run.updatedAt = new Date().toISOString();
        try {
            await runState.saveRun(run);
        }
        catch (error) {
            this.failed = true;
            throw error;
        }
    }

    async guard<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        }
        catch (error) {
            this.failed = true;
            throw error;
        }
    }
}
