import { Check, Field, Input, Notice } from "../../components/ui";
import type { AnalysisSetupState } from "./analysis-setup";
import { DEFAULT_PROBE, PRESET_OPTIONS, presetPatch, probeProblems } from "./use-analysis-presets";

/** Preset chooser, reliability probe settings and the long-context option with its accuracy caveat (spec sections 5.4, 6, 7). */
export function PresetSection({ state }: { state: AnalysisSetupState }) {
  const { settings, change, preview } = state;
  const preset = settings.preset ?? "custom";
  const probe = settings.probe;
  const problems = probeProblems(probe);
  const suggested = preview?.v2?.suggestedWindowSize;
  return (
    <section className="well an-well" aria-labelledby="an-preset-h">
      <div className="an-well-head">
        <h2 id="an-preset-h">Preset</h2>
        <p>A preset sets the window; anything you change below overrides it.</p>
      </div>
      <div className="stack" role="radiogroup" aria-labelledby="an-preset-h">
        {PRESET_OPTIONS.map((option) => (
          <label key={option.id} className="an-preset">
            <input
              type="radio"
              name="analysis-preset"
              checked={preset === option.id}
              onChange={() => change(presetPatch(option.id, settings))}
            />
            <span>
              <strong>{option.label}</strong>
              <span className="small muted"> {option.summary}</span>
            </span>
          </label>
        ))}
      </div>
      {preset === "windowed" && suggested !== undefined && suggested !== settings.windowSize && (
        <Notice>The preview suggests a window of {suggested} steps: the largest up to 8 with no oversized window.</Notice>
      )}
      <div className="an-well-head">
        <h2>Reliability probe</h2>
        <p>Re-scores a seeded sample of windows several times after the main pass, to measure the noise floor.</p>
      </div>
      <Check
        label="Run the reliability probe"
        checked={!!probe}
        onChange={(e) => change({ probe: e.target.checked ? { ...DEFAULT_PROBE } : null })}
      />
      {probe && (
        <div className="three">
          <Field label="Windows to probe (1 to 50)">
            <Input type="number" min="1" max="50" value={probe.windows}
              onChange={(e) => change({ probe: { ...probe, windows: e.target.valueAsNumber } })} />
          </Field>
          <Field label="Repeats per window (1 to 10)">
            <Input type="number" min="1" max="10" value={probe.repeats}
              onChange={(e) => change({ probe: { ...probe, repeats: e.target.valueAsNumber } })} />
          </Field>
          <Field label="Sampling seed">
            <Input value={probe.seed} onChange={(e) => change({ probe: { ...probe, seed: e.target.value } })} />
          </Field>
        </div>
      )}
      {problems.map((message) => <Notice key={message} kind="error">{message}</Notice>)}
      <div className="an-well-head">
        <h2>Long context</h2>
      </div>
      <Check
        label="Use long-context mode (262k tokens)"
        checked={!!settings.longContext}
        onChange={(e) => change({ longContext: e.target.checked })}
      />
      <p className="small muted">
        Sends the provider's long-context header and raises the input limits to 262k tokens at the same price. The provider documents
        this mode as slower and less accurate, so it is off in every preset except whole-run.
      </p>
    </section>
  );
}
