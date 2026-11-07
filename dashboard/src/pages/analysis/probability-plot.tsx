import type { AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";

export function ProbabilityPlot({
  code,
  windows,
  onSelect,
}: {
  code: BehaviorCode;
  windows: AnalysisWindow[];
  onSelect: (w: AnalysisWindow) => void;
}) {
  const min = Math.min(...windows.map((w) => w.startStep)),
    max = Math.max(...windows.map((w) => w.endStep));
  const x = (end: number) => 36 + ((end - min) / Math.max(1, max - min)) * 624;
  const y = (p: number) => 91 - p * 75;
  let path = "";
  let connected = false;
  for (const w of windows) {
    const score = w.results?.find((r) => r.codeId === code.id)?.probability;
    if (score == null) {
      connected = false;
      continue;
    }
    path += (connected ? " L" : " M") + x(w.endStep) + "," + y(score);
    connected = true;
  }
  return (
    <section style={{ marginBottom: 20 }}>
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 12 }}>
          <span
            className="color-dot"
            style={{ background: code.color, marginRight: 8 }}
          />
          {code.code}
        </h3>
        <span className="helper">
          {min}–{max} source steps
        </span>
      </div>
      <p className="helper">{code.definition}</p>
      <svg
        className="chart"
        viewBox="0 0 700 112"
        role="img"
        aria-label={`${code.code} probability plot; the accessible score table contains the same values.`}
      >
        <line x1="36" x2="670" y1="16" y2="16" className="chart-grid" />
        <line x1="36" x2="670" y1="91" y2="91" className="chart-grid" />
        <text x="2" y="20" className="chart-label">
          100%
        </text>
        <text x="13" y="94" className="chart-label">
          0%
        </text>
        <path d={path} className="chart-line" />
        {windows.map((w) => {
          const score = w.results?.find(
            (r) => r.codeId === code.id,
          )?.probability;
          return score == null ? (
            <text
              key={w.id}
              x={x(w.endStep)}
              y="56"
              className="chart-label"
              textAnchor="middle"
            >
              —
            </text>
          ) : (
            <circle
              key={w.id}
              cx={x(w.endStep)}
              cy={y(score)}
              r="4"
              className="chart-point"
              role="button"
              tabIndex={0}
              aria-label={`${code.code}: ${(score * 100).toFixed(1)}%, steps ${w.startStep} to ${w.endStep}. Inspect window.`}
              onClick={() => onSelect(w)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(w);
                }
              }}
            >
              <title>{`${code.code} · ${w.startStep}–${w.endStep} · ${(score * 100).toFixed(1)}% · ${w.partial ? "partial window" : w.incomplete ? "incomplete evidence" : "recorded evidence"}`}</title>
            </circle>
          );
        })}
        <text x="36" y="109" className="chart-label">
          {min}
        </text>
        <text x="657" y="109" className="chart-label">
          {max}
        </text>
      </svg>
    </section>
  );
}
