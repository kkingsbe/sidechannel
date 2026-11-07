import { Badge, Button, Card, CardHeading, Notice, Table } from "../../components/ui";
import { evidenceCategories as categories } from "../../lib/analysis-types";
import type { AnalysisSetupState } from "./analysis-setup";

export function PreparedWindows({ state }: { state: AnalysisSetupState }) {
  const { preview, setPreviewWindow } = state;
  return (
    <>
          {preview && (
            <Card className="form-section">
              <CardHeading
                title="Prepared windows"
                description="Inspect the unchanged boundaries and request budget before launching."
              />
              <div className="card-body">
                <div className="data-grid">
                  <div className="data-point">
                    <span>Source steps</span>
                    <strong>{preview.manifest.selectedStepCount}</strong>
                  </div>
                  <div className="data-point">
                    <span>Windows</span>
                    <strong>{preview.manifest.windowCount}</strong>
                  </div>
                  <div className="data-point">
                    <span>Partial windows</span>
                    <strong>{preview.manifest.partialWindowCount}</strong>
                  </div>
                  <div className="data-point">
                    <span>Enabled behaviors</span>
                    <strong>{preview.manifest.scoredCodeCount}</strong>
                  </div>
                </div>
                <div className="actions" style={{ margin: "16px 0" }}>
                  {categories.map((c) => (
                    <Badge key={c}>
                      {c}: {preview.manifest.availability[c] ?? "unavailable"}
                    </Badge>
                  ))}
                </div>
                {preview.manifest.diagnostics.map((d) => (
                  <Notice kind="warning" key={d}>
                    {d}
                  </Notice>
                ))}
              </div>
              <Table
                label="Prepared analysis windows"
                headers={["Window", "Range", "Coverage", "Input budget", ""]}
              >
                {preview.windows.map((window) => (
                  <tr key={window.id}>
                    <td>W{window.index + 1}</td>
                    <td>
                      {window.startStep}–{window.endStep}
                    </td>
                    <td>
                      <Badge>
                        {window.partial
                          ? "Partial"
                          : window.incomplete
                            ? "Incomplete"
                            : "Complete boundaries"}
                      </Badge>
                    </td>
                    <td>
                      {window.budget.estimatedTokens.toLocaleString()} estimated
                      tokens
                      <br />
                      <Badge tone={window.budget.oversized ? "warning" : "neutral"}>
                        {window.budget.oversized
                          ? "Oversized · no score"
                          : window.budget.batches.length + " tag batches"}
                      </Badge>
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPreviewWindow(window)}
                      >
                        Exact input
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
    </>
  );
}
