import type { JobCounters } from '@sidechannel/contracts/analysis/jev-repository';

export const emptyCounters = (): JobCounters => ({ preparedWindows: 0, submittedWindows: 0, finishedWindows: 0, failedWindows: 0, skippedWindows: 0, returnedAnswers: 0, expectedAnswers: 0 });