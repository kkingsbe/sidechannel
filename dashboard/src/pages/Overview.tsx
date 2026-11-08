import { useState } from 'react';
import type React from 'react';
import { NavLink } from 'react-router-dom';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardHeading, ConditionPill, Empty, ErrorState, Kpi, KpiStrip, Loading, PageHeader, Stamp } from '../components/ui';
import { useApi } from '../lib/api';
import { useClients } from '../lib/clients/context';
import type { Run, Draft } from '../lib/types';
import { jobStatusMetaFor, overviewCards, runStatusMetaFor } from '../lib/status';
import { short, when } from '../lib/utils';
import { PairTable } from '../components/pairs/PairTable';
import { failureSentence, groupByPair } from '../components/pairs/group';
import './Overview.css';

interface OverviewData {
  observedAt: string; counts: Record<string, number>; activity: Run[]; recent: Run[]; attention: Run[];
  worker: { capacity: number; available: boolean | null; status: string; note?: string; heartbeatAt?: string };
}
interface Job {
  id: string; status: string; runId?: string; runIds?: string[]; createdAt: string; updatedAt: string;
  manifest?: { settings?: { model?: string; windowSize?: number; stride?: number } };
}
const PAIR_ROWS = 5;
const position = (run: Run) => `R${run.round ?? 0} · T${run.turn ?? 0}`;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function ResearchJobs({ title, path, destination, linkLabel = 'All', emptyTitle, emptyText, rows: rowLimit = 3 }: { title: string; path: string; destination: string; linkLabel?: string; emptyTitle: string; emptyText: string; rows?: number }) {
  const jobs = useApi<{ items: Job[]; nextCursor: string | null }>(path, { interval: 5000 }), rows = (jobs.data?.items ?? []).slice(0, rowLimit);
  return <Card><CardHeading title={title} count={jobs.data ? (jobs.data.nextCursor ? `${jobs.data.items.length}+` : jobs.data.items.length) : undefined} actions={<NavLink className="link" to={destination}>{linkLabel}</NavLink>} />
    {jobs.loading ? <Loading /> : jobs.error && !jobs.data ? <ErrorState error={jobs.error} retry={jobs.refresh} /> : !rows.length ? <Empty title={emptyTitle} description={emptyText} /> :
      <div role="list" aria-label={title}>
        {rows.map(job => { const meta = jobStatusMetaFor(job.status); return <div role="listitem" className="trow job-row" key={job.id}>
          <div><NavLink className="link" to={`${destination}/${job.id}`}>{job.manifest?.settings?.model ? `${job.manifest.settings.model} · ${job.manifest.settings.windowSize}-step windows` : `Evaluation · ${plural(job.runIds?.length ?? 0, 'source run')}`}</NavLink>
            <span className="small muted block">{job.runId ? <NavLink className="mono" to={`/runs/${job.runId}`}>Source run {short(job.runId)}</NavLink> : <span className="mono">{short(job.id)}</span>} · {when(job.updatedAt || job.createdAt)}</span></div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>; })}
      </div>}
    {jobs.error && jobs.data && <div className="card-foot" role="status">Updates unavailable · last refreshed {jobs.updatedAt ? new Date(jobs.updatedAt).toLocaleTimeString() : 'unknown'}<Button variant="secondary" size="sm" onClick={jobs.refresh}>Retry</Button></div>}
  </Card>;
}
const steps = [
  { title: 'Configure a matched pair', text: 'Choose the task, agents, and model; review both conditions.', to: '/experiments/new' },
  { title: 'Watch the runs', text: 'Inspect execution, board delivery, artifacts, and private memory.', to: '/runs' },
  { title: 'Define behaviour codes', text: 'Write the codebook that analysis windows are scored against.', to: '/codebook' },
  { title: 'Screen and review in Analysis', text: 'Open analysis results or continue a saved review batch.', to: '/analysis' },
  { title: 'Compare oversight views', text: 'Evaluate what routine operator review would and would not have seen.', to: '/oversight' },
];
const gettingStartedKey = 'sidechannel-overview-getting-started';
function GettingStarted({ first }: { first: boolean }) {
  const [open, setOpen] = useState(() => { try { const saved = localStorage.getItem(gettingStartedKey); return saved === null ? first : saved === 'open'; } catch { return first; } });
  return <details className="card onboarding" open={open} onToggle={event => { const next = event.currentTarget.open; setOpen(next); try { localStorage.setItem(gettingStartedKey, next ? 'open' : 'closed'); } catch { /* Convenience only. */ } }}><summary>Getting started with the research workflow</summary><ol className="workflow-list">{steps.map(item => <li key={item.to}><NavLink to={item.to}><div><strong>{item.title}</strong><p>{item.text}</p></div><ArrowUpRight size={15} aria-hidden="true" /></NavLink></li>)}</ol></details>;
}

/** Failed and interrupted runs, each with a one-sentence reason and a route to the full diagnostic. */
function NeedsAttention({ runs, query }: { runs: Run[]; query: string }) {
  return <Card className="c12"><CardHeading title="Needs attention" count={plural(runs.length, 'run')} actions={<NavLink className="link" to={`/runs?status=${encodeURIComponent(query)}`}>All failed and interrupted runs</NavLink>} />
    <div role="list" aria-label="Runs that need attention">
      {runs.map(run => { const meta = runStatusMetaFor(run.status); return <div role="listitem" className="trow att-row" key={run.id}>
        <div><NavLink className="link block" to={`/runs/${run.id}`}>{run.config?.label || short(run.id)}</NavLink><span className="small muted">{run.config?.scenario?.version ?? 'Scenario unavailable'} · <span className="mono">{short(run.id)}</span></span></div>
        <div><ConditionPill condition={run.config?.condition?.id} /></div>
        <span className="muted att-model">{run.config?.model?.provider} / {run.config?.model?.id}</span>
        <div><Badge tone={meta.tone}>{meta.label}</Badge> <span className="muted">at {position(run)}</span>
          {run.failureReason && <span className="small muted block" title={run.failureReason}>{failureSentence(run.failureReason)} <NavLink className="link plain" to={`/runs/${run.id}`}>Full diagnostic</NavLink></span>}</div>
        <span className="muted small att-when">{when(run.updatedAt)}</span>
        <Button asChild variant="secondary" size="sm"><NavLink to={`/runs/${run.id}`} aria-label={`Inspect ${run.config?.label || 'run'} · ${run.config?.condition?.id ?? ''} · ${run.id}`}>Inspect</NavLink></Button>
      </div>; })}
    </div>
  </Card>;
}

function workerSentence(worker: OverviewData['worker'] | undefined, busy: boolean) {
  if (!worker) return null;
  const heartbeat = worker.note?.match(/(\d+\s?s)\s+ago/)?.[1];
  const state = worker.available === false ? 'unavailable' : worker.available === true ? (busy ? 'working' : 'idle') : 'in an unknown state';
  return `The experiment worker is ${state}, capacity ${worker.capacity}${heartbeat ? `, heartbeat ${heartbeat} ago` : ''}.`;
}

export default function Overview() {
  const clients = useClients();
  const overview = useApi<OverviewData>(clients.workspace.paths.overview(), { interval: 5000 }), runs = useApi<{ items: Run[]; total?: number }>(clients.runs.paths.list({ summary: true, limit: 16 }), { interval: 5000 });
  const drafts = useApi<Draft[]>(clients.workspace.paths.drafts());
  const counts = overview.data?.counts, data = runs.data?.items ?? [];
  const count = (...states: string[]) => counts ? states.reduce((sum, state) => sum + (counts[state] ?? 0), 0) : null;
  const [active, queued, , attention] = overviewCards;
  const total = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : null;
  const completed = count('completed'), failedLike = count(...attention!.statuses), busy = count(...active!.statuses, ...queued!.statuses);
  const link = (...states: string[]) => `/runs?status=${encodeURIComponent(states.join(','))}`;
  const noCompletedRuns = completed === 0;
  const attentionRuns = overview.data?.attention ?? [];
  const groups = groupByPair(data), shown = groups.slice(0, PAIR_ROWS);
  const allShown = runs.data?.total === undefined || runs.data.total <= data.length;
  const worker = workerSentence(overview.data?.worker, !!busy);
  let finding: React.ReactNode;
  if (attentionRuns.length) {
    const reasons = new Set(attentionRuns.map(run => run.failureReason ? failureSentence(run.failureReason) : ''));
    const spots = new Set(attentionRuns.map(position));
    const shared = [reasons.size === 1 && [...reasons][0] ? `with the same error (${[...reasons][0].replace(/[.]$/, '')})` : '', spots.size === 1 ? `at ${[...spots][0]}` : ''].filter(Boolean).join(' ');
    finding = <><strong>{plural(attentionRuns.length, 'run')} {attentionRuns.every(run => run.status === 'failed') ? 'failed' : 'failed or was interrupted'}{shared ? `, ${shared}` : ''}.</strong> {worker}</>;
  } else if (total !== null) {
    finding = <><strong>{plural(total, 'run')} recorded, {completed ?? 0} completed.</strong> {worker}</>;
  } else finding = 'Connecting to the researcher API.';
  return <><PageHeader title="Overview" description={finding} actions={<><Stamp at={overview.updatedAt} stale={!!overview.error} label="Evidence refreshed" /><Button variant="ghost" size="icon" aria-label="Refresh evidence" onClick={() => { void overview.refresh(); void runs.refresh(); }}><RefreshCw size={16} /></Button><Button asChild><NavLink to="/experiments/new">New experiment</NavLink></Button></>} />
    {overview.error && <ErrorState error={overview.error} retry={overview.refresh} />}
    <KpiStrip aria-label="Run counts">
      <Kpi label="Runs recorded" value={total ?? '—'} to="/runs" />
      <Kpi label="Completed" value={completed ?? '—'} to={link('completed')} detail={overview.error ? 'stale' : undefined} />
      <Kpi label="Cancelled" value={count('cancelled') ?? '—'} to={link('cancelled')} />
      <Kpi label="Failed" value={failedLike ?? '—'} tone={failedLike ? 'bad' : undefined} to={link(...attention!.statuses)} detail={failedLike ? 'failed or interrupted' : undefined} />
      <Kpi label="Running or queued" value={busy ?? '—'} to={link(...active!.statuses, ...queued!.statuses)} detail={overview.data?.worker.available === true ? `worker available · capacity ${overview.data.worker.capacity}` : overview.data?.worker.available === false ? 'worker unavailable' : undefined} />
    </KpiStrip>
    {!!drafts.data?.length && <div className="resume-strip"><strong>{plural(drafts.data.length, 'saved experiment draft')}</strong><NavLink className="link" to="/experiments">Resume a draft <ArrowUpRight size={14} /></NavLink></div>}
    {noCompletedRuns && <div className="overview-gap"><GettingStarted first /></div>}
    <div className="g12">
      {!!attentionRuns.length && <NeedsAttention runs={attentionRuns} query={attention!.statuses.join(',')} />}
      <Card className="c8"><CardHeading title="Recent pairs" count={groups.length || undefined} actions={<NavLink className="link" to="/runs">All pairs</NavLink>} />
        {runs.loading ? <Loading /> : runs.error && !runs.data ? <ErrorState error={runs.error} retry={runs.refresh} /> : shown.length ? <PairTable runs={shown.flatMap(group => group.runs)} label="Recent matched pairs" /> : <Empty title="Your first experiment starts here" description="Create a draft, validate its configuration, and launch a matched pair."><Button asChild><NavLink to="/experiments/new">Create experiment</NavLink></Button></Empty>}
        <div className="card-foot">{runs.error ? <>Updates unavailable · last refreshed {runs.updatedAt ? new Date(runs.updatedAt).toLocaleTimeString() : 'unknown'}<Button size="sm" variant="secondary" onClick={runs.refresh}>Retry</Button></> : <><span>Progress tracks show rounds and turns completed.</span><span className="num">{allShown ? `${shown.length} of ${groups.length} pairs` : `Latest ${shown.length} pairs`}</span></>}</div>
      </Card>
      <div className="c4 stack">
        <ResearchJobs title="Analyses" path={clients.analyses.paths.list({ limit: 6 })} destination="/analysis" emptyTitle="No analyses yet" emptyText="Start one from a completed run." />
        <ResearchJobs title="Monitor evaluations" path={clients.monitor.paths.evaluations({ limit: 6 })} destination="/oversight" linkLabel="Configure" emptyTitle="No monitor evaluations yet" emptyText={completed ? `Start one from a completed run; ${plural(completed, 'completed run')} can be evaluated.` : 'Start one from a completed run once a run completes.'} />
      </div>
    </div>
    <div className="services-line" aria-label="Services">
      <span className="who-chip" style={{ '--c': overview.error ? 'var(--danger-fg)' : 'var(--success-fg)' } as React.CSSProperties}>Researcher API {overview.error ? 'updates unavailable' : overview.data ? 'connected' : 'connecting'}{overview.updatedAt && ` · last success ${new Date(overview.updatedAt).toLocaleTimeString()}`}</span>
      <span className="who-chip" style={{ '--c': overview.data?.worker.available ? 'var(--success-fg)' : 'var(--amber)' } as React.CSSProperties}>Experiment worker {overview.data?.worker.available === true ? 'available' : overview.data?.worker.available === false ? 'unavailable' : 'availability unknown'} · capacity {overview.data?.worker.capacity ?? 'unknown'}{overview.error && ' · stale reading'}{overview.data?.worker.note && ` · ${overview.data.worker.note.replace(/\.$/, '').toLowerCase()}`}</span>
    </div>
    {!noCompletedRuns && <div className="overview-gap"><GettingStarted first={false} /></div>}
  </>;
}
