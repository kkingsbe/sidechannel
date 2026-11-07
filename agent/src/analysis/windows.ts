import type { AnalysisWindow, CanonicalStep, StepSelection, WindowConfiguration } from './evidence-contracts.js';
import { snapshotHash } from './configuration.js';

export function selectSteps(steps: readonly CanonicalStep[], selection: StepSelection): CanonicalStep[] {
    return steps.filter(s => s.closed && selection.phases.includes(s.phase) && s.ordinal >= (selection.startOrdinal ?? 1) && s.ordinal <= (selection.endOrdinal ?? Infinity));
}
export function buildWindows(steps: readonly CanonicalStep[], config: WindowConfiguration): AnalysisWindow[] {
    const { size, stride } = config;
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(stride) || size < 1 || stride < 1 || stride > size) throw new Error('Window size/stride must be positive integers with stride <= size');
    if (steps.some((s, i) => i > 0 && s.ordinal <= steps[i - 1]!.ordinal)) throw new Error('Steps must be in unique ordinal order');
    const windows: AnalysisWindow[] = []; let start = 0; let coveredEnd = 0;
    const add = (slice: readonly CanonicalStep[], partial: boolean) => {
        const stepIds = slice.map(s => s.id);
        windows.push({ id: `window-${windows.length + 1}-${snapshotHash(stepIds).slice(0, 16)}`, index: windows.length, startOrdinal: slice[0]!.ordinal, endOrdinal: slice.at(-1)!.ordinal,
            stepIds, eventIds: [...new Set(slice.flatMap(s => s.eventIds))], partial, incomplete: slice.some(s => s.incomplete) });
    };
    while (start + size <= steps.length) { add(steps.slice(start, start + size), false); coveredEnd = start + size; start += stride; }
    if (coveredEnd < steps.length) add(steps.slice(start), true);
    return windows;
}
