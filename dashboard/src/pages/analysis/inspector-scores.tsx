import type { AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";
import { scoreOf, sortWindows } from "./analysis-view";

/** One decimal, matching the heatmap tooltip and the scores the reviewer sees elsewhere. */
export const pct1 = (p: number) => (p * 100).toFixed(1);
const thresholdLabel = (threshold: number) => `${Math.round(threshold * 100)}%`;

/** The selected behaviour's figure, how far it sits from the threshold and its frozen definition. */
export function LeadFigure({
  code,
  probability,
  threshold,
}: {
  code: BehaviorCode;
  probability: number | undefined;
  threshold: number;
}) {
  const gap =
    probability == null
      ? "No score for this window"
      : probability >= threshold
        ? `At or above the ${thresholdLabel(threshold)} threshold`
        : `${((threshold - probability) * 100).toFixed(1)} points under the ${thresholdLabel(threshold)} threshold`;
  return (
    <div>
      <div className="wi-lead-label">{code.code} · model estimate</div>
      <div className="wi-lead-figure" data-testid="lead-figure">
        {probability == null ? "—" : pct1(probability)}
        {probability != null && <span>%</span>}
      </div>
      <div className={"wi-lead-gap" + (probability != null && probability >= threshold ? " at" : "")}>{gap}</div>
      {code.definition && <p className="wi-lead-def">{code.definition}</p>}
    </div>
  );
}

const BAR_MAX = 36;

/** The selected behaviour across every window of the run; the current window is outlined. */
export function RunStrip({
  windows,
  current,
  code,
  threshold,
}: {
  windows: AnalysisWindow[];
  current: AnalysisWindow;
  code: BehaviorCode;
  threshold: number;
}) {
  const ordered = sortWindows(windows.some((w) => w.id === current.id) ? windows : [...windows, current]);
  const currentAt = ordered.findIndex((w) => w.id === current.id);
  const hits = ordered.filter((w) => {
    const p = scoreOf(w, code.id);
    return p != null && p >= threshold;
  }).length;
  const here = scoreOf(current, code.id);
  const label = `${code.code} across ${ordered.length} windows: ${hits} at or above ${thresholdLabel(threshold)}. This window is ${
    here == null ? "not scored" : pct1(here) + "%"
  }.`;
  const showTick = (i: number) =>
    i === 0 ||
    i === ordered.length - 1 ||
    i === currentAt ||
    ((i + 1) % 10 === 0 && Math.abs(i - currentAt) > 2);
  const columns = { gridTemplateColumns: `repeat(${ordered.length}, minmax(0, 1fr))` };
  return (
    <div>
      <div className="wi-strip-head">
        <span>{code.code} across the run</span>
        <span>
          {hits} of {ordered.length} windows at or above {thresholdLabel(threshold)}
        </span>
      </div>
      <div className="wi-strip" role="img" aria-label={label} style={columns}>
        {ordered.map((w, i) => {
          const p = scoreOf(w, code.id);
          const classes = ["wi-bar"];
          if (p == null) classes.push("none");
          if (p != null && p >= threshold) classes.push("hit");
          if (i === currentAt) classes.push("now");
          return (
            <span
              key={w.id}
              className={classes.join(" ")}
              title={`Window ${w.index + 1}: ${p == null ? "no score" : pct1(p) + "%"}`}
              style={
                p == null
                  ? undefined
                  : {
                      height: Math.max(3, Math.round(p * BAR_MAX)),
                      background: `color-mix(in srgb, var(--blue) ${Math.round(25 + p * 75)}%, transparent)`,
                    }
              }
            />
          );
        })}
      </div>
      <div className="wi-ticks" style={columns} aria-hidden="true">
        {ordered.map((w, i) => (
          <span key={w.id} className={i === currentAt ? "now" : undefined}>
            {showTick(i) ? <span>{w.index + 1}</span> : null}
          </span>
        ))}
      </div>
      <div className="wi-legend">
        <span>
          <i className="swatch now" />
          This window
        </span>
        <span>
          <i className="swatch hit" />
          At or above {thresholdLabel(threshold)}
        </span>
        <span>Bar height and tone both show probability</span>
      </div>
    </div>
  );
}

/** Every behaviour's score for this window, highest first; picking one drives the lead block and the judgment form. */
export function BehaviorGrid({
  window: win,
  codes,
  selected,
  threshold,
  onPick,
}: {
  window: AnalysisWindow;
  codes: BehaviorCode[];
  selected: string;
  threshold: number;
  onPick: (codeId: string) => void;
}) {
  const rows = codes
    .map((code) => ({ code, p: scoreOf(win, code.id) }))
    .sort((a, b) => (b.p ?? -1) - (a.p ?? -1));
  return (
    <section aria-labelledby="wi-all-behaviors">
      <div className="wi-section-head">
        <h2 id="wi-all-behaviors">All behaviors in this window</h2>
        <span className="wi-note">Exploratory estimates, not calibrated labels</span>
      </div>
      <div className="wi-bgrid">
        {rows.map(({ code, p }) => (
          <button
            key={code.id}
            type="button"
            className="wi-bpick"
            aria-pressed={code.id === selected}
            onClick={() => onPick(code.id)}
          >
            <span className="wi-bpick-row">
              <span className="wi-bpick-code">{code.code}</span>
              <span className="wi-bpick-value">{p == null ? "—" : pct1(p) + "%"}</span>
            </span>
            <span className="wi-track">
              {p != null && <span className="wi-fill" style={{ width: `${p * 100}%` }} />}
              <span className="wi-tick" style={{ left: `${threshold * 100}%` }} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Blind first pass: no scores, no strip, only empty slots where the behaviours would be. */
export function BlindPanel({ codes }: { codes: BehaviorCode[] }) {
  return (
    <section className="wi-blind" aria-labelledby="wi-blind-h">
      <div>
        <h2 id="wi-blind-h">Blind first pass</h2>
        <p>Scores, the run strip and earlier judgments appear after you save.</p>
      </div>
      <div>
        <div
          className="wi-blind-slots"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(codes.length, 9))}, minmax(0, 1fr))` }}
          aria-label={`${codes.length} behaviors, scores hidden`}
        >
          {codes.map((code) => (
            <span key={code.id} title={code.code}>
              {code.code}
            </span>
          ))}
        </div>
        <p className="wi-blind-line">
          Judge from the evidence alone. Your first save is recorded as <strong>suggestions hidden</strong>.
        </p>
      </div>
    </section>
  );
}
