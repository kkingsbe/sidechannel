import React, { useContext, useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Badge, Button, Card, CardHeading, ConditionPill, ErrorState, JsonView, Loading, Notice, Table } from "../../components/ui";
import { WorkspaceTitleContext } from "../../lib/workspace-context";
import { ArtifactView } from "../../components/artifact-view";
import { useClients } from "../../lib/clients/context";
import { useCommand } from "../../components/use-command";
import { useScenarios } from "../../lib/descriptors";
import { useResource, type Resource } from "../../lib/clients/query";
import type { Run } from "../../lib/types";
import { runStatusMetaFor } from "../../lib/status";
import { short, when } from "../../lib/utils";
import { comparability, conditionCells, failureSentence } from "../../components/pairs/group";
import { safeRunReturn } from "./run-detail";
import { configValue, settingLabel } from "./pair-settings";

type PairResponse = { runs: Run[]; configurationDifferences: unknown[]; matched: boolean };
const position = (run: Run) => `R${run.round ?? 0} · T${run.turn ?? 0}`;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Fetches one condition's full record (board, artifacts, reports) and keeps it fresh. */
function useConditionRun(summary: Run | undefined): Resource<Run> {
  const clients = useClients();
  return useResource<Run>(summary ? `run:${summary.id}:pair-condition` : null, () => clients.runs.get(summary!.id), { interval: 5000 });
}

const Side = ({ condition, children }: { condition: string; children?: React.ReactNode }) => (
  <div className={"pair-side" + (condition === "excluded" ? " excluded" : "")} data-cond={condition}>{children}</div>
);

function CountBar({ value, max, excluded }: { value: number | undefined; max: number; excluded: boolean }) {
  if (value === undefined) return <span className="muted">—</span>;
  return (
    <div className="count-bar">
      <span className="num">{value}</span>
      <span className="track" aria-hidden="true">
        <i style={{ width: `${max ? Math.round((value / max) * 100) : 0}%`, background: excluded ? "var(--amber)" : undefined }} />
      </span>
    </div>
  );
}

function PairView({ id, pair }: { id: string; pair: PairResponse }) {
  const clients = useClients();
  const navigate = useNavigate();
  const command = useCommand();
  const scenarios = useScenarios();
  const [params] = useSearchParams();
  const returnTo = safeRunReturn(params.get("returnTo"));
  const suffix = "&returnTo=" + encodeURIComponent(returnTo);
  const summaries = conditionCells(pair.runs).filter((run): run is Run => !!run);
  const a = useConditionRun(summaries[0]);
  const b = useConditionRun(summaries[1]);
  const resources = [a, b];
  const runs = summaries.map((summary, index) => resources[index]!.data ?? summary);
  const first = runs[0];
  const label = first?.config?.label || "Pair comparison";
  const setWorkspaceTitle = useContext(WorkspaceTitleContext);
  useEffect(() => {
    setWorkspaceTitle(label);
  }, [label, setWorkspaceTitle]);
  const verdict = comparability(runs);
  const duplicatePair = async () => {
    const result = await command.run(() =>
      clients.request<{ id: string }>(`/pairs/${encodeURIComponent(id)}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Copy of " + (first?.config?.label ?? id) }),
      }),
    );
    if (result) navigate("/experiments?draft=" + result.id);
  };
  const posts = resources.map((r) => (r.data ? (r.data.board?.length ?? 0) : undefined));
  const versions = resources.map((r) => (r.data ? (r.data.artifacts?.length ?? 0) : undefined));
  const reports = resources.map((r) => (r.data ? (r.data.reports?.length ?? 0) : undefined));
  const maxOf = (values: (number | undefined)[]) => Math.max(0, ...values.filter((v): v is number => v !== undefined));
  const name = (index: number) => runs[index]?.config?.condition?.id ?? (index ? "excluded" : "reviewed");
  const sentence =
    verdict.state === "yes"
      ? `The pair is comparable end to end: ${verdict.reason}.`
      : verdict.state === "pending"
        ? `The pair is not finished: ${verdict.reason}.`
        : `The pair is recorded but not comparable end to end: ${verdict.reason}.`;
  let lead: React.ReactNode = null;
  if (posts[0] !== undefined && posts[1] !== undefined) {
    lead =
      posts[0] === posts[1] ? (
        <strong>Both boards carried {plural(posts[0], "post")}.</strong>
      ) : (
        <strong>
          The {name(posts[0] > posts[1] ? 0 : 1)} board carried {Math.max(posts[0], posts[1])} posts against{" "}
          {Math.min(posts[0], posts[1])} on the {name(posts[0] > posts[1] ? 1 : 0)} board.
        </strong>
      );
  }
  const finalOf = (run: Run | undefined) => run?.artifacts?.filter((item) => item.frozen).at(-1);
  const exportLinks = runs.map((run, index) => (
    <Button key={run.id} asChild variant="secondary">
      <a href={clients.runs.exportUrl(run.id)} download>
        Export {name(index)}
      </a>
    </Button>
  ));
  const failureRuns = runs.filter((run) => run.failureReason);
  return (
    <>
      <Link className="crumb-back" to={returnTo}>
        <ArrowLeft size={14} aria-hidden="true" />
        All runs
      </Link>
      <header className="objhead">
        <div className="glyph" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 22 22">
            <rect x="2" y="4" width="18" height="5" rx="2.5" fill="var(--blue)" />
            <rect x="7" y="13" width="13" height="5" rx="2.5" fill="var(--amber)" />
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="titleline">
            <h1>{label}</h1>
            <Badge tone={verdict.state === "yes" ? "success" : verdict.state === "pending" ? "info" : "warning"}>
              {verdict.state === "yes" ? "comparable" : verdict.state === "pending" ? "in progress" : "not comparable"}
            </Badge>
          </div>
          <div className="meta">
            <span>
              {first?.config?.scenario?.version}
              {first?.config?.model?.id && <> · {first.config.model.provider} / {first.config.model.id}</>}
              {(first as { configHash?: string } | undefined)?.configHash && (
                <> · frozen configuration <span className="mono">{(first as { configHash?: string }).configHash!.slice(0, 8)}</span></>
              )}
            </span>
            <span>·</span>
            <span className="mono" title={id}>{short(id)}</span>
            <span>·</span>
            <span>updated {when(runs.map((run) => run.updatedAt).sort().at(-1))}</span>
          </div>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={duplicatePair} disabled={command.busy}>
            Duplicate config
          </Button>
          {exportLinks}
        </div>
      </header>
      {command.error && <Notice kind="error">{command.error.message}</Notice>}
      <p className="finding pair-finding">
        {lead} {sentence}
      </p>
      {!pair.matched && (
        <Notice kind="warning">Configuration differences need review before treating these as matched conditions.</Notice>
      )}

      <Card className="pair-compare">
        <div className="pair-grid" role="table" aria-label="Condition comparison">
          <div className="pair-row" role="row">
            <div className="pair-label muted small" role="rowheader">Condition</div>
            {[0, 1].map((index) => {
              const run = runs[index];
              if (!run) return <Side key={index} condition="excluded"><p className="muted">Other condition unavailable: the pair response does not contain a second run. The recorded run remains available.</p></Side>;
              const meta = runStatusMetaFor(run.status);
              return (
                <Side key={run.id} condition={name(index)}>
                  <div className="cond-head">
                    <span className="cond-name">{name(index)}</span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <p className="muted small">{run.config.condition.text}</p>
                </Side>
              );
            })}
          </div>

          <div className="pair-row" role="row">
            <div className="pair-label muted" role="rowheader">Execution</div>
            {[0, 1].map((index) => {
              const run = runs[index];
              if (!run) return <Side key={index} condition="excluded" />;
              const broken = run.status === "failed" || run.status === "interrupted";
              const turnsPer = (run.config as { scheduler?: { order?: unknown[] } }).scheduler?.order?.length;
              const total = run.config.scheduler.rounds && turnsPer ? run.config.scheduler.rounds * turnsPer : undefined;
              const share = total ? Math.min(1, (run.turn ?? 0) / total) : run.config.scheduler.rounds ? Math.min(1, (run.round ?? 0) / run.config.scheduler.rounds) : 0;
              return (
                <Side key={run.id} condition={name(index)}>
                  <div className="lane-line">
                    <span className="track" aria-hidden="true">
                      <i className={broken ? "hatch" : undefined} style={{ width: `${Math.max(broken ? 7 : 0, Math.round(share * 100))}%`, background: name(index) === "excluded" && !broken ? "var(--amber)" : undefined }} />
                    </span>
                    <span className="prog">{position(run)}</span>
                  </div>
                  <div className="small muted">
                    {run.status} · recorded {when(run.updatedAt)}
                  </div>
                </Side>
              );
            })}
          </div>

          {!!failureRuns.length && (
            <div className="pair-row" role="row">
              <div className="pair-label muted" role="rowheader">Failure</div>
              {[0, 1].map((index) => {
                const run = runs[index];
                return (
                  <Side key={run?.id ?? index} condition={name(index)}>
                    {run?.failureReason ? (
                      <span title={run.failureReason}>
                        {failureSentence(run.failureReason)}{" "}
                        <Link className="link plain" to={"/runs/" + run.id + "?view=timeline" + suffix}>Full diagnostic</Link>
                      </span>
                    ) : (
                      <span className="muted">None recorded</span>
                    )}
                  </Side>
                );
              })}
            </div>
          )}

          {[
            ["Board posts", posts],
            ["Artifact versions", versions],
            ["Final reports", reports],
          ].map(([title, values]) => (
            <div className="pair-row" role="row" key={title as string}>
              <div className="pair-label muted" role="rowheader">{title as string}</div>
              {[0, 1].map((index) => (
                <Side key={index} condition={name(index)}>
                  {runs[index] ? (
                    resources[index]!.error && !resources[index]!.data ? (
                      <span className="muted">Unavailable</span>
                    ) : (
                      <CountBar value={(values as (number | undefined)[])[index]} max={maxOf(values as (number | undefined)[])} excluded={name(index) === "excluded"} />
                    )
                  ) : null}
                </Side>
              ))}
            </div>
          ))}

          <div className="pair-row" role="row">
            <div className="pair-label muted" role="rowheader">Final artifact</div>
            {[0, 1].map((index) => {
              const run = runs[index];
              if (!run) return <Side key={index} condition="excluded" />;
              const resource = resources[index]!;
              const final = finalOf(resource.data);
              return (
                <Side key={run.id} condition={name(index)}>
                  {resource.loading ? (
                    <span className="muted">Checking recorded artifacts</span>
                  ) : resource.data ? (
                    final ? (
                      <div className="pair-artifact">
                        <span className="small muted">Frozen version {final.version}</span>
                        <ArtifactView value={final.value} artifactSchemaVersion={scenarios.view(run.config.scenario.version).artifactSchemaVersion} />
                      </div>
                    ) : (
                      <span className="muted">No frozen final artifact recorded.</span>
                    )
                  ) : (
                    <span className="muted">Artifact availability unknown.</span>
                  )}
                </Side>
              );
            })}
          </div>

          <div className="pair-row" role="row">
            <div className="pair-label muted" role="rowheader">Report text</div>
            {[0, 1].map((index) => {
              const run = runs[index];
              if (!run) return <Side key={index} condition="excluded" />;
              const resource = resources[index]!;
              return (
                <Side key={run.id} condition={name(index)}>
                  {resource.data ? (
                    resource.data.reports?.length ? (
                      resource.data.reports.map((report) => (
                        <details key={report.agentId}>
                          <summary>
                            {report.agentId} · {report.parsed === null ? "invalid or unparsed" : "recorded report"}
                          </summary>
                          <p className="text-block">{report.raw}</p>
                        </details>
                      ))
                    ) : (
                      <span className="muted">No final reports recorded.</span>
                    )
                  ) : (
                    <span className="muted">{resource.loading ? "Checking recorded reports" : "Report availability unknown."}</span>
                  )}
                </Side>
              );
            })}
          </div>

          <div className="pair-row" role="row">
            <div className="pair-label muted" role="rowheader">Downstream</div>
            {[0, 1].map((index) => {
              const run = runs[index];
              if (!run) return <Side key={index} condition="excluded" />;
              const resource = resources[index]!;
              return (
                <Side key={run.id} condition={name(index)}>
                  <div className="pair-links">
                    <Link className="link" to={"/runs/" + run.id + "?view=timeline" + suffix}>Inspect evidence</Link>
                    <Link className="link" to={"/runs/" + run.id + "?view=artifacts" + suffix}>Artifact history</Link>
                    <Link className="link" to={"/runs/" + run.id + "?view=reports" + suffix}>Reports</Link>
                  </div>
                  {resource.error && (
                    <span className="small muted">
                      Output availability could not be refreshed.{" "}
                      <Button variant="ghost" size="sm" onClick={resource.refresh}>Retry</Button>
                    </span>
                  )}
                </Side>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="g12">
        <Card className="c7">
          <CardHeading title="Configuration differences" count={plural(pair.configurationDifferences.length, "field")} />
          {pair.configurationDifferences.length ? (
            <Table label="Differing frozen settings" headers={["Setting", ...runs.map((run) => run.config.condition.id)]}>
              {pair.configurationDifferences.map((path, index) => (
                <tr key={index}>
                  <th scope="row" className="setting-name">{settingLabel(String(path))}</th>
                  {runs.map((run) => (
                    <td key={run.id} className="text-block">
                      {String(path) === "condition.id" ? <ConditionPill condition={run.config.condition.id} /> : configValue(run.config, String(path))}
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
          ) : (
            <div className="card-body"><p className="muted">No configuration differences were returned.</p></div>
          )}
          <div className="card-body">
            <JsonView value={pair.configurationDifferences} title="Exact differing field paths" />
          </div>
          <div className="card-foot">
            <span>
              {pair.matched
                ? "Scenario, model, roles, scheduling, memory and reporting match; the server verified every other field."
                : "Matching outside the condition has not been established."}
            </span>
          </div>
        </Card>
        <Card className="c5">
          <CardHeading title="Shared frozen configuration" actions={first && <Link className="link" to={"/runs/" + first.id}>Full configuration</Link>} />
          <div className="card-body">
            {first ? (
              <dl className="kv pair-kv">
                <dt>Scenario</dt>
                <dd>{first.config.scenario.version}{first.config.scenario.datasetId && <> · {first.config.scenario.datasetId}</>}</dd>
                <dt>Model</dt>
                <dd>
                  {first.config.model.provider} / {first.config.model.id}
                  {(first.config.model.settings as { maxOutputTokens?: number } | undefined)?.maxOutputTokens && (
                    <> · max output {(first.config.model.settings as { maxOutputTokens: number }).maxOutputTokens.toLocaleString()}</>
                  )}
                </dd>
                {!!(first.config as { scheduler?: { order?: string[] } }).scheduler?.order?.length && (
                  <>
                    <dt>Roles</dt>
                    <dd>{(first.config as { scheduler: { order: string[] } }).scheduler.order.join(" → ")}</dd>
                  </>
                )}
                <dt>Rounds</dt>
                <dd className="num">
                  {first.config.scheduler.rounds}
                  {(first.config.scheduler as { toolCallsPerTurn?: number }).toolCallsPerTurn !== undefined && <> · {(first.config.scheduler as { toolCallsPerTurn?: number }).toolCallsPerTurn} tool calls per turn</>}
                </dd>
                {first.config.phase && (
                  <>
                    <dt>Designation</dt>
                    <dd>{first.config.phase}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="muted">No frozen configuration recorded.</p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

export function PairDetail() {
  const clients = useClients();
  const { id } = useParams();
  const pair = useResource<PairResponse>(id ? `pair:${id}` : null, () => clients.runs.pair(id!) as Promise<PairResponse>);
  if (pair.loading) return <Loading />;
  if (!pair.data) return <ErrorState error={pair.error} retry={pair.refresh} />;
  return <PairView id={id!} pair={pair.data} />;
}
