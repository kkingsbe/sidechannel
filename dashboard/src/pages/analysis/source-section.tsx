import { Badge, Button, Card, CardHeading, ErrorState, Field, Input, Notice, Pager, Select } from "../../components/ui";
import { Link } from "react-router-dom";
import type { Run } from "../../lib/types";
import type { AnalysisJob, AnalysisSettings, Codebook, CodebookRevision } from "../../lib/analysis-types";
import { short, when } from "../../lib/utils";
import type { AnalysisSetupState } from "./analysis-setup";

export function SourceSection({ state }: { state: AnalysisSetupState }) {
  const { runId, runs, source, books, revision, revisionHistory, settings, change, currentRevision, setParams, setPreview } = state;
  return (
    <>
          <Card className="form-section">
            <CardHeading title="Source & frozen definitions" />
            <div className="card-body form-grid">
              <div>
                <Field
                  required
                  label="Source run"
                  hint="Only terminal runs can be analyzed."
                >
                  <Select
                    value={runId}
                    onChange={(e) => {
                      setParams((prev) => {
                        prev.set("run", e.target.value);
                        return prev;
                      });
                      setPreview(undefined);
                    }}
                  >
                    <option value="">Select a source run</option>
                    {runId &&
                      !runs.data.some((run) => run.id === runId) && (
                        <option value={runId}>
                          {source.data?.config.label || runId} · selected source
                        </option>
                      )}
                    {runs.data.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.config.label} · {run.status} · {short(run.id)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Pager page={runs.page} hasMore={runs.hasMore} onChange={runs.onChange} />
              </div>
              <div>
                <Field label="Codebook" required>
                  <Select
                    value={settings.codebookId}
                    onChange={(e) => {
                      const book = books.data.find(
                        (b) => b.id === e.target.value,
                      );
                      change({
                        codebookId: e.target.value,
                        codebookRevisionId: book?.currentRevisionId || "",
                      });
                    }}
                  >
                    <option value="">Select codebook</option>
                    {settings.codebookId &&
                      !books.data.some(
                        (book) => book.id === settings.codebookId,
                      ) && (
                        <option value={settings.codebookId}>
                          {revision.data?.codebook.name || "Selected codebook"}
                        </option>
                      )}
                    {books.data.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Pager page={books.page} hasMore={books.hasMore} onChange={books.onChange} />
              </div>
              <div>
                <Field
                  required
                  label="Codebook revision"
                  hint="Historical definitions remain read-only. New analyses use the current codebook revision."
                >
                  <Select
                    value={settings.codebookRevisionId}
                    onChange={(e) =>
                      change({ codebookRevisionId: e.target.value })
                    }
                  >
                    {revision.data &&
                      !revisionHistory.data.some(
                        (item) => item.id === revision.data?.revision.id,
                      ) && (
                        <option value={revision.data.revision.id}>
                          Current revision {revision.data.revision.revision}
                        </option>
                      )}
                    {revisionHistory.data.map((item) => (
                      <option
                        key={item.id}
                        value={item.id}
                        disabled={item.id !== revision.data?.revision.id}
                      >
                        Revision {item.revision} · {when(item.createdAt)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Pager page={revisionHistory.page} hasMore={revisionHistory.hasMore} onChange={revisionHistory.onChange} />
              </div>
              <Field
                required
                label="Researcher / creator"
                hint="Claimed identity in the open workspace."
              >
                <Input
                  value={settings.creator}
                  onChange={(e) => change({ creator: e.target.value })}
                />
              </Field>
              {currentRevision && (
                <div className="full actions">
                  {currentRevision.codes
                    .filter((c) => c.enabled && !c.archived)
                    .map((code) => (
                      <Badge key={code.id}>{code.code}</Badge>
                    ))}
                </div>
              )}
              {source.data && (
                <div className="helper full">
                  Source {source.data.status} ·{" "}
                  {source.data.config.model.provider}/
                  {source.data.config.model.id} · config{" "}
                  {short(source.data.configHash)}. Missing evidence is recorded
                  separately from excluded categories.
                </div>
              )}
              {(runs.error || books.error || source.error) && (
                <div className="full">
                  <ErrorState
                    error={runs.error || books.error || source.error}
                  />
                </div>
              )}
            </div>
          </Card>
    </>
  );
}
