import { Badge, Drawer, JsonView, Notice } from "../../components/ui";
import type { MonitorPreview, Projection, Verdict } from "@sidechannel/contracts/browser";
import { reviewDecisionMeta } from "../../lib/status";
import { ProjectionInspector } from "./projection-inspector";
import type { ResultSelection } from "./verdict-matrix";
import { viewNames } from "./views";

type Judgment = {
  verdict: Verdict;
  explanation: string;
  evidenceIds: string[];
};

/** The cited-verdict inspector: explanation, citations and the exact supplied projection. */
export function VerdictDrawer({
  selection,
  judgment,
  resultProjection,
  usage,
  onOpenChange,
}: {
  selection: ResultSelection | undefined;
  judgment: Judgment | undefined;
  resultProjection: Projection | undefined;
  usage: unknown;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer
      open={!!selection}
      onOpenChange={onOpenChange}
      title={
        selection ? viewNames[selection.view] + " verdict" : "Monitor verdict"
      }
    >
      {judgment && (
        <>
          <Badge tone={reviewDecisionMeta[judgment.verdict].tone}>{reviewDecisionMeta[judgment.verdict].label}</Badge>
          <p className="text-block" style={{ margin: "14px 0" }}>
            {judgment.explanation}
          </p>
          <h3>Supporting evidence IDs</h3>
          {judgment.evidenceIds.length ? (
            judgment.evidenceIds.map((evidenceId) => {
              const valid = resultProjection?.evidenceIds.includes(evidenceId);
              return (
                <div key={evidenceId} style={{ marginTop: 10 }}>
                  <span className="mono">{evidenceId}</span>
                  <Badge tone={valid ? "success" : "danger"}>
                    {valid
                      ? "In supplied projection"
                      : "Unsupported / not verified"}
                  </Badge>
                </div>
              );
            })
          ) : (
            <p className="helper">
              No event citations. The explanation must state missing evidence
              or limitations for an absent or uncertain judgment.
            </p>
          )}
          <hr className="section-divider" />
          {resultProjection ? (
            <ProjectionInspector projection={resultProjection} />
          ) : (
            <Notice kind="warning">
              Exact projection provenance is unavailable; citations are not
              rendered as valid source links.
            </Notice>
          )}
          <JsonView value={usage} title="Recorded monitor usage" />
        </>
      )}
    </Drawer>
  );
}

export type { MonitorPreview };
