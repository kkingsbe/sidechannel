import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { Run } from '@sidechannel/contracts/harness/contracts';

export const fixtureConfig = () => resolveConfiguration(defaultFixtureConfiguration());

/** A queued run with a deterministic createdAt so queue ordering is testable. */
export function queuedRun(launchKey: string, overrides: Partial<Run> = {}): Run {
    return { ...createQueuedRun(fixtureConfig(), launchKey), ...overrides };
}
