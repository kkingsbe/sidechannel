import { Card, CardHeading, Notice } from "../../components/ui";
import type { AnalysisSetupState } from "./analysis-setup";

/** The exact background text each question group will receive, with the condition shown as absent (spec section 11). */
export function BackgroundPreview({ state }: { state: AnalysisSetupState }) {
  const v2 = state.preview?.v2;
  if (!v2) return null;
  return (
    <Card>
      <CardHeading ruled title="What each question sees" />
      <div className="card-body an-body">
        <p className="small" role="status">
          <strong>Condition: not sent.</strong>{" "}
          {v2.conditionExcluded
            ? "The experimental condition has no path into any request, and every request is checked for its text before it is sent."
            : "The condition could not be confirmed absent."}
        </p>
        {v2.conditionQuotedWindows.length > 0 && (
          <Notice kind="warning">
            {v2.conditionQuotedWindows.length} window(s) quote the condition text in the agents' own words. Those windows will be refused
            rather than sent.
          </Notice>
        )}
        {v2.groups.map((group) => (
          <section key={group.key || "none"} className="an-bg-group">
            <h3 className="small">
              {group.parts.length ? `Background: ${group.parts.join(" + ")}` : "No background"}
              <span className="muted"> · {group.codeIds.length} code(s): {group.codeIds.join(", ")}</span>
            </h3>
            {group.parts.length === 0 && <p className="small muted">These questions are sent in their own request, without task or policy text.</p>}
            {group.parts.map((part) => (
              <details key={part}>
                <summary>{part}</summary>
                <pre className="an-bg-text">{group.text[part] ?? ""}</pre>
              </details>
            ))}
          </section>
        ))}
        {v2.probe && (
          <p className="small muted">
            Probe: {v2.probe.windowIds.length} window(s) re-scored {v2.probe.repeats} times each (seed {v2.probe.seed}).
          </p>
        )}
      </div>
    </Card>
  );
}
