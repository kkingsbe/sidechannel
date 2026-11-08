import type { AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";
import { gapLabel, hasScores, heatStyle } from "./analysis-summary";
import { percent, scoreOf } from "./analysis-view";
import { useElementWidth } from "./use-element-width";

const LABEL_W = 132;
/** Below this column pitch a cell cannot hold its figure; the value moves to the tooltip. */
const MIN_PITCH_FOR_VALUES = 20;

/** The heatmap: one row per behaviour, one column per window, always fitted to the card width. */
export function HeatmapTable({
  windows,
  codes,
  threshold,
  onSelect,
}: {
  windows: AnalysisWindow[];
  codes: BehaviorCode[];
  threshold: number;
  onSelect: (window: AnalysisWindow) => void;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const pitch = (width - LABEL_W) / Math.max(1, windows.length);
  const showValues = pitch >= MIN_PITCH_FOR_VALUES;
  return (
    <div className="an-heat-wrap" ref={ref}>
      <table
        className={"an-heat" + (showValues ? "" : " compact")}
        aria-label="Behavior probability heatmap"
      >
        <colgroup>
          <col style={{ width: LABEL_W }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Behavior</span>
            </th>
            {windows.map((w, i) => (
              <th key={w.id} scope="col" title={`Steps ${w.startStep}–${w.endStep}`}>
                {i === 0 || (i + 1) % 5 === 0 ? <span>{w.endStep}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code.id}>
              <th scope="row" title={code.name || code.code}>
                {code.code}
              </th>
              {windows.map((w) => {
                const score = scoreOf(w, code.id);
                const range = `steps ${w.startStep}–${w.endStep}`;
                const missing = score == null;
                return (
                  <td key={w.id}>
                    <button
                      type="button"
                      className={
                        "an-cell" + (missing ? " skip" : score >= threshold ? " hi" : "")
                      }
                      style={missing ? undefined : heatStyle(score)}
                      title={
                        missing
                          ? `${code.code} · ${range} · ${hasScores(w) ? "no score" : gapLabel(w)}`
                          : `${code.code} · ${range} · ${percent(score)}%`
                      }
                      aria-label={
                        missing
                          ? `${code.code}, ${range}: no score. Inspect window.`
                          : `${code.code}, ${range}: ${percent(score)}%. Inspect window.`
                      }
                      onClick={() => onSelect(w)}
                    >
                      {missing ? "" : percent(score)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="an-legend small muted">
        <span>
          <i className="ramp" />0 → 100%
        </span>
        <span>
          <i className="out" />
          at or above {Math.round(threshold * 100)}%
        </span>
        <span>
          <i className="hatch" />
          skipped window
        </span>
      </div>
    </div>
  );
}
