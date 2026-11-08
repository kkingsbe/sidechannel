import { useId } from "react";
import type { AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";
import { hasScores } from "./analysis-summary";
import { percent, scoreOf, sortWindows } from "./analysis-view";
import { floorBand } from "./summary-view";
import { useElementWidth } from "./use-element-width";

const HEIGHT = 224;
const TOP = 12;
const BOTTOM = 188;
const LEFT = 38;
const RIGHT = 12;

/** One behaviour over the run: gaps across unscored windows, a dot for an isolated scored window. */
export function ProbabilityPlot({
  code,
  windows,
  threshold,
  onSelect,
  floor,
  excluded,
}: {
  code: BehaviorCode;
  windows: AnalysisWindow[];
  threshold: number;
  onSelect: (w: AnalysisWindow) => void;
  /** Repeat-variance sd for this code from the job's reliability probe: shades the undecided band around the threshold. */
  floor?: number;
  /** Windows excluded from run metrics by an audit code: hatched. */
  excluded?: ReadonlySet<string>;
}) {
  const hatch = "an-hatch" + useId().replace(/:/g, "");
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const ordered = sortWindows(windows);
  const ends = ordered.map((w) => w.endStep);
  const min = Math.min(...ends);
  const max = Math.max(...ends);
  const plotW = Math.max(40, width - LEFT - RIGHT);
  const x = (end: number) => LEFT + (max === min ? plotW / 2 : ((end - min) / (max - min)) * plotW);
  const y = (p: number) => BOTTOM - p * (BOTTOM - TOP);
  const pitch = ordered.length > 1 ? plotW / (ordered.length - 1) : 20;

  const scores = ordered.map((w) => scoreOf(w, code.id));
  // Runs of consecutive scored windows; a run of one is a lone dot.
  const runs: number[][] = [];
  scores.forEach((s, i) => {
    if (s == null) return;
    if (i > 0 && scores[i - 1] != null) runs[runs.length - 1]!.push(i);
    else runs.push([i]);
  });
  const ticks: number[] = [];
  for (let t = Math.ceil(min / 10) * 10; t <= max; t += 10) ticks.push(t);
  if (!ticks.includes(min) && (ticks[0] ?? Infinity) - min >= 4) ticks.unshift(min);
  const thrY = y(threshold);
  const band = floorBand(threshold, floor);
  const thrText = `${Math.round(threshold * 100)}% threshold`;

  return (
    <div ref={ref} className="an-plot">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={`${code.code} probability per source step, ${min} to ${max}, with the ${Math.round(threshold * 100)}% threshold; unscored windows are gaps. The score table has the same values.`}
      >
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={width - RIGHT} y1={y(t / 100)} y2={y(t / 100)} className="chart-grid" />
            <text x={LEFT - 6} y={y(t / 100) + 4} textAnchor="end" className="chart-label">
              {t}
            </text>
          </g>
        ))}
        <defs>
          <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--foreground)" strokeWidth="1.5" opacity="0.35" />
          </pattern>
        </defs>
        {band && (
          <rect x={LEFT} width={width - LEFT - RIGHT} y={y(band.high)} height={Math.max(1, y(band.low) - y(band.high))} className="an-floor">
            <title>{`Within one probe floor (sd ${Math.round(floor! * 1000) / 10}%) of the threshold: scores in this band are undecided.`}</title>
          </rect>
        )}
        {ordered.map((w) =>
          excluded?.has(w.id) ? (
            <rect key={"audit-" + w.id} x={x(w.endStep) - pitch / 2} y={TOP} width={pitch} height={BOTTOM - TOP} fill={`url(#${hatch})`} data-audit-excluded="true">
              <title>{`Steps ${w.startStep}–${w.endStep} · excluded from run metrics by an audit code`}</title>
            </rect>
          ) : null,
        )}
        {ordered.map((w, i) =>
          scores[i] == null ? (
            <rect
              key={w.id}
              x={x(w.endStep) - pitch / 2}
              y={TOP}
              width={pitch}
              height={BOTTOM - TOP}
              className="an-gap"
            >
              <title>{`Steps ${w.startStep}–${w.endStep} · ${hasScores(w) ? "no score" : "not scored"}`}</title>
            </rect>
          ) : null,
        )}
        <line
          x1={LEFT}
          x2={width - RIGHT}
          y1={thrY}
          y2={thrY}
          stroke="var(--foreground)"
          strokeDasharray="4 4"
        />
        <text
          x={width - RIGHT}
          y={threshold > 0.85 ? thrY + 14 : thrY - 5}
          textAnchor="end"
          className="chart-label"
          style={{ fill: "var(--foreground)" }}
        >
          {thrText}
        </text>
        {runs
          .filter((run) => run.length > 1)
          .map((run) => (
            <polyline
              key={run[0]}
              className="chart-line"
              points={run.map((i) => `${x(ordered[i]!.endStep)},${y(scores[i]!)}`).join(" ")}
            />
          ))}
        {runs
          .filter((run) => run.length === 1)
          .map(([i]) => (
            <circle key={i} cx={x(ordered[i!]!.endStep)} cy={y(scores[i!]!)} r="3.5" fill="currentColor" />
          ))}
        {ordered.map((w, i) => {
          const score = scores[i];
          if (score == null) return null;
          return (
            <circle
              key={w.id}
              cx={x(w.endStep)}
              cy={y(score)}
              r={Math.max(4, Math.min(8, pitch / 2))}
              className="an-hit"
              role="button"
              tabIndex={0}
              aria-label={`${code.code}: ${percent(score)}%, steps ${w.startStep} to ${w.endStep}. Inspect window.`}
              onClick={() => onSelect(w)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(w);
                }
              }}
            >
              <title>{`${code.code} · steps ${w.startStep}–${w.endStep} · ${percent(score)}%${w.partial ? " · partial window" : w.incomplete ? " · incomplete evidence" : ""}`}</title>
            </circle>
          );
        })}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={HEIGHT - 8} textAnchor="middle" className="chart-label">
            {t}
          </text>
        ))}
      </svg>
    </div>
  );
}
