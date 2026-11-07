import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, ArrowUpRight, BookOpen, FlaskConical, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, CardHeading, Empty, ErrorState, Loading, PageHeader, Table } from '../components/ui';
import { useApi, arrayOf } from '../lib/api';
import type { Run, Draft } from '../lib/types';
import { short, when } from '../lib/utils';
import { RunTable } from '../App';
import { PairTable } from '../components/pairs/PairTable';
import './Overview.css';

interface OverviewData {
  observedAt: string; counts: Record<string, number>; activity: Run[]; recent: Run[]; attention: Run[];
  worker: { capacity: number; available: boolean | null; status: string; note?: string };
}
interface Job {
  id: string; status: string; runId?: string; runIds?: string[]; createdAt: string; updatedAt: string;
  manifest?: { settings?: { model?: string; windowSize?: number; stride?: number } };
}
function ResearchJobs({ title, path, destination }: { title: string; path: string; destination: string }) {
  const jobs = useApi<{ items: Job[]; nextCursor: string | null }>(path, 5000), rows = arrayOf(jobs.data);
  return <Card><CardHeading title={title} actions={<Button asChild variant="ghost" size="sm"><NavLink to={destination}>View all <ArrowUpRight size={15} /></NavLink></Button>} />
    {jobs.loading ? <Loading /> : jobs.error && !jobs.data ? <ErrorState error={jobs.error} retry={jobs.refresh} /> : !rows.length ? <Empty title={`No ${title.toLowerCase()} yet`} description="Start from a source run when you are ready." /> :
      <Table label={title} headers={['Job / source', 'Status', 'Updated']}>
        {rows.map(job => <tr key={job.id}><td><NavLink className="table-title" to={`${destination}/${job.id}`}>{job.manifest?.settings?.model ? `${job.manifest.settings.model} · ${job.manifest.settings.windowSize} step windows` : `Evaluation · ${job.runIds?.length ?? 0} source runs`}</NavLink><small>{job.runId ? <NavLink className="text-link" to={`/runs/${job.runId}`}>Source run {short(job.runId)}</NavLink> : short(job.id)}</small></td><td><Badge status={job.status} /></td><td className="muted">{when(job.updatedAt || job.createdAt)}</td></tr>)}
      </Table>}
    {jobs.error && jobs.data && <div className="card-foot" role="status">Updates unavailable · last refreshed {jobs.updatedAt ? new Date(jobs.updatedAt).toLocaleTimeString() : 'unknown'}<Button variant="secondary" size="sm" onClick={jobs.refresh}>Retry</Button></div>}
    {jobs.data?.nextCursor && <div className="card-foot">Showing the latest page. Open the collection for more jobs.</div>}
  </Card>;
}
const steps = [
  { n: '01', title: 'Configure a matched pair', text: 'Choose the task, agents, and model; review both conditions.', to: '/experiments/new' },
  { n: '02', title: 'Watch the runs', text: 'Inspect execution, board delivery, artifacts, and private memory.', to: '/runs' },
  { n: '03', title: 'Define behaviour codes', text: 'Write the codebook that analysis windows are scored against.', to: '/codebook' },
  { n: '04', title: 'Screen and review in Analysis', text: 'Open analysis results or continue a saved review batch.', to: '/analysis' },
  { n: '05', title: 'Compare oversight views', text: 'Evaluate what routine operator review would and would not have seen.', to: '/oversight' },
];
const gettingStartedKey = 'sidechannel-overview-getting-started';
function GettingStarted({ first }: { first: boolean }) {
  const [open, setOpen] = useState(() => { try { const saved = localStorage.getItem(gettingStartedKey); return saved === null ? first : saved === 'open'; } catch { return first; } });
  return <details className="card onboarding" open={open} onToggle={event => { const next = event.currentTarget.open; setOpen(next); try { localStorage.setItem(gettingStartedKey, next ? 'open' : 'closed'); } catch { /* Convenience only. */ } }}><summary>Getting started with the research workflow</summary><ol className="workflow-list">{steps.map(item => <li key={item.n}><NavLink to={item.to}><span>{item.n}</span><div><strong>{item.title}</strong><p>{item.text}</p></div><ArrowUpRight size={15} aria-hidden="true" /></NavLink></li>)}</ol></details>;
}
export default function Overview() {
  const overview = useApi<OverviewData>('/overview', 5000), runs = useApi<{ items: Run[] }>('/runs?summary=true&limit=16', 5000);
  const drafts = useApi<Draft[]>('/drafts');
  const counts = overview.data?.counts, data = arrayOf(runs.data);
  const count = (...states: string[]) => counts ? states.reduce((sum, state) => sum + (counts[state] ?? 0), 0) : null;
  const stats = [
    { label: 'Active runs', value: count('running', 'reporting', 'stopping'), states: 'running,reporting,stopping', detail: 'Inspect execution progress', icon: Activity },
    { label: 'Queued runs', value: count('queued'), states: 'queued', detail: 'Awaiting the experiment worker', icon: FlaskConical },
    { label: 'Completed runs', value: count('completed'), states: 'completed', detail: 'Open recorded evidence', icon: BookOpen },
    { label: 'Needs attention', value: count('failed', 'interrupted'), states: 'failed,interrupted', detail: 'Inspect failure or interruption', icon: ShieldCheck },
  ];
  const noCompletedRuns = count('completed') === 0;
  return <><PageHeader title="Workspace overview" description="Resume research, inspect evidence, and follow independent jobs." actions={<Button asChild><NavLink to="/experiments/new"><FlaskConical size={16} aria-hidden="true" />New experiment</NavLink></Button>} />
    {noCompletedRuns && <GettingStarted first />}
    <div className="stat-grid compact-stats">{stats.map(({ label, value, detail, states, icon: Icon }) => <NavLink className="card stat-card" to={`/runs?status=${encodeURIComponent(states)}`} key={label}><div>{label}<Icon size={18} aria-hidden="true" /></div><strong>{value ?? '—'}</strong><p>{detail}{overview.error && ' · stale'}</p></NavLink>)}</div>
    {overview.error && <ErrorState error={overview.error} retry={overview.refresh} />}
    {!!drafts.data?.length && <div className="resume-strip"><strong>{drafts.data.length} saved experiment {drafts.data.length === 1 ? 'draft' : 'drafts'}</strong><NavLink className="text-link" to="/experiments">Resume a draft <ArrowUpRight size={14} /></NavLink></div>}
    <div className="stack overview-operational">
      {!!overview.data?.attention.length && <Card><CardHeading title="Requires attention" description="Failed or interrupted runs remain available with recorded evidence." /><RunTable runs={overview.data.attention} /></Card>}
      {!!overview.data?.activity.length && <Card><CardHeading title="In progress & queued" /><RunTable runs={overview.data.activity} /></Card>}
      <Card><CardHeading title="Recent pairs" actions={<Button variant="ghost" size="sm" asChild><NavLink to="/runs">View all pairs <ArrowUpRight size={15} /></NavLink></Button>} />
        {runs.loading ? <Loading /> : runs.error && !runs.data ? <ErrorState error={runs.error} retry={runs.refresh} /> : data.length ? <PairTable runs={data} label="Recent matched pairs" /> : <Empty title="Your first experiment starts here" description="Create a draft, validate its configuration, and launch a matched pair."><Button asChild><NavLink to="/experiments/new">Create experiment</NavLink></Button></Empty>}
        <div className="card-foot">{runs.error ? `Updates unavailable · last refreshed ${runs.updatedAt ? new Date(runs.updatedAt).toLocaleTimeString() : 'unknown'}` : runs.updatedAt ? `Evidence refreshed at ${new Date(runs.updatedAt).toLocaleTimeString()}` : 'Connecting to researcher API'}{runs.error && <Button size="sm" variant="secondary" onClick={runs.refresh}>Retry</Button>}</div>
      </Card>
      <div className="form-grid"><ResearchJobs title="Analyses" path="/analyses?limit=6" destination="/analysis" /><ResearchJobs title="Monitor evaluations" path="/monitor-evaluations?limit=6" destination="/oversight" /></div>
      <Card><CardHeading title="Services & freshness" /><div className="card-body service-summary"><div><strong>Researcher API</strong><p>{overview.error ? 'Updates unavailable' : overview.data ? 'Connected' : 'Connecting'}{overview.updatedAt && ` · last success ${new Date(overview.updatedAt).toLocaleTimeString()}`}</p></div><div><strong>Experiment worker</strong>{overview.error && <p>Stale reading - last observed {overview.updatedAt ? new Date(overview.updatedAt).toLocaleTimeString() : 'unknown'}. Retry the API update to check availability.</p>}<p>{overview.data?.worker.available === true ? 'Available' : overview.data?.worker.available === false ? 'Unavailable' : 'Availability unknown'} · capacity {overview.data?.worker.capacity ?? 'unknown'}</p><p>{overview.data?.worker.note ?? 'API connectivity does not establish worker availability.'}</p></div></div></Card>
      {!noCompletedRuns && <GettingStarted first={false} />}
    </div>
  </>;
}
