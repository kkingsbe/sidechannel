import type { HarnessEvent } from '@sidechannel/contracts/harness/contracts';
import type { Repository } from '@sidechannel/contracts/harness/server';

/** The only repository capabilities oversight needs; it accepts a full `Repository` unchanged. */
export type OversightSource = Pick<Repository, 'getRun' | 'listEvents'>;

export async function readEvents(repository: OversightSource, runId: string): Promise<HarnessEvent[]> {
    const events: HarnessEvent[] = [];
    let after = 0;
    while (true) {
        const page = await repository.listEvents(runId, after, 1000);
        events.push(...page);
        if (page.length < 1000) break;
        after = page[page.length - 1]!.sequence;
    }
    return events;
}
