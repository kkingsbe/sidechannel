import type { AnalysisPreset, ProbeConfiguration } from "@sidechannel/contracts/browser";
import type { AnalysisSettings } from "../../lib/analysis-types";

/** Whole-run window: larger than any run (mirrors the server's resolver, spec section 7). */
export const WHOLE_RUN_WINDOW = 10_000;

export const PRESET_OPTIONS: { id: AnalysisPreset; label: string; summary: string }[] = [
  { id: "dense", label: "Dense (default)", summary: "One window per step, all codes. Step-level attribution, about 6k tokens per step." },
  { id: "windowed", label: "Windowed", summary: "Six steps, advancing three. Finds patterns that span steps." },
  { id: "whole-run", label: "Whole run (experimental)", summary: "One window over every step, window-scoped codes only. Needs long-context mode; scores are not aggregated with the others." },
  { id: "custom", label: "Custom", summary: "Set the window yourself, as in earlier analyses." },
];

export const DEFAULT_PROBE: ProbeConfiguration = { windows: 6, repeats: 4, seed: "probe-v1" };

/** The settings a preset implies. `custom` keeps whatever the draft already has. */
export function presetPatch(preset: AnalysisPreset, current: AnalysisSettings): Partial<AnalysisSettings> {
  switch (preset) {
    case "dense": return { preset, windowSize: 1, stride: 1, longContext: false, probe: current.probe ?? { ...DEFAULT_PROBE } };
    case "windowed": return { preset, windowSize: 6, stride: 3, longContext: false, probe: current.probe ?? { ...DEFAULT_PROBE } };
    case "whole-run": return { preset, windowSize: WHOLE_RUN_WINDOW, stride: WHOLE_RUN_WINDOW, longContext: true, probe: current.probe ?? { ...DEFAULT_PROBE } };
    default: return { preset };
  }
}

/** Probe fields validate like the server: windows 1 to 50, repeats 1 to 10, nonempty seed. */
export function probeProblems(probe: ProbeConfiguration | null | undefined): string[] {
  if (!probe) return [];
  const bad = (n: number, max: number) => !Number.isInteger(n) || n < 1 || n > max;
  return [
    bad(probe.windows, 50) && "Probe windows must be a whole number from 1 to 50.",
    bad(probe.repeats, 10) && "Probe repeats must be a whole number from 1 to 10.",
    !probe.seed.trim() && "Probe seed cannot be empty.",
  ].filter((m): m is string => !!m);
}
