import { NavLink } from 'react-router-dom';
import { Activity, ArrowUpRight, BookOpen, FlaskConical, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, CardHeading, Empty, ErrorState, Loading, PageHeader, Table } from '../components/ui';
import { useApi, arrayOf } from '../lib/api';
import type { Run } from '../lib/types';
import { short, when } from '../lib/utils';
import { RunTable } from '../App';

interface OverviewData {
  observedAt: string; counts: Record<string, number>; activity: Run[]; recent: Run[]; attention: Run[];
  worker: { capacity: number; available: boolean | null; status: string; note?: string };
}
interface Job { id: string; status: string; runId?: string; runIds?: string[]; createdAt: string; updatedAt: string }
function ResearchJobs({ title, path, destination }: { title: string; path: string; destination: string }) {
  const jobs = useApi<{ items: Job[]; nextCursor: string | null }>(path, 5000), rows = arrayOf(jobs.data);
  return <Card><CardHeading title={title} description="Independent jobs; separate from experiment state" actions={<Button asChild variant="ghost" size="sm"><NavLink to={destination}>Open workspace <ArrowUpRight size={15} /></NavLink></Button>} />
    {jobs.loading ? <Loading /> : jobs.error ? <ErrorState error={jobs.error} retry={jobs.refresh} /> : !rows.length ? <Empty title={`No ${title.toLowerCase()} yet`} description="Start from a completed source run when you are ready." /> :
      <Table label={title} headers={['Job', 'Source', 'Status', 'Updated']}>
        {rows.map(job => <tr key={job.id}><td><NavLink className="table-title mono" to={`${destination}/${job.id}`}>{short(job.id)}</NavLink></td><td>{job.runId ? <NavLink className="text-link" to={`/runs/${job.runId}`}>{short(job.runId)}</NavLink> : `${job.runIds?.length ?? 0} runs`}</td><td><Badge status={job.status} /></td><td className="muted nowrap">{when(job.updatedAt || job.createdAt)}</td></tr>)}
      </Table>}
    {jobs.data?.nextCursor && <div className="card-foot">Showing a bounded page. Open the workspace for more jobs.</div>}
  </Card>;
}
export default function Overview() {
  const overview = useApi<OverviewData>('/overview', 5000), runs = useApi<{ items: Run[] }>('/runs?summary=true&limit=8', 5000);
  const counts = overview.data?.counts, data = arrayOf(runs.data);
  const count = (...states: string[]) => counts ? states.reduce((sum, state) => sum + (counts[state] ?? 0), 0) : null;
  const stats = [
    { label: 'Active experiments', value: count('running', 'reporting', 'stopping'), detail: 'Action, reporting, and stopping', icon: Activity },
    { label: 'In the queue', value: count('queued'), detail: 'Awaiting the experiment worker', icon: FlaskConical },
    { label: 'Completed runs', value: count('completed'), detail: 'Source evidence ready to inspect', icon: BookOpen },
    { label: 'Needs attention', value: count('failed', 'interrupted'), detail: 'Failed or interrupted experiments', icon: ShieldCheck },
  ];
  return <><PageHeader eyebrow="THE RESEARCH DESK" title="Workspace overview" description="Configure, observe, and understand your experiments in one place." actions={<Button asChild><NavLink to="/experiments"><FlaskConical size={16} aria-hidden="true" />New experiment</NavLink></Button>} />
    <div className="stat-grid">{stats.map(({ label, value, detail, icon: Icon }) => <Card className="stat-card" key={label}><div>{label}<Icon size={18} aria-hidden="true" /></div><strong>{value ?? '—'}</strong><p>{detail}{overview.error && ' · stale'}</p></Card>)}</div>
    <div className="overview-grid"><div className="overview-main min-w-0">
      {!!overview.data?.activity.length && <Card className="mb-5"><CardHeading title="In progress & queued" description="The experiment worker executes one run at a time." /><RunTable runs={overview.data.activity} /></Card>}
      <Card><CardHeading title="Recent runs" description="Live execution and immutable evidence" actions={<Button variant="ghost" size="sm" asChild><NavLink to="/runs">View all runs <ArrowUpRight size={15} /></NavLink></Button>} />
        {runs.loading ? <Loading /> : runs.error && !runs.data ? <ErrorState error={runs.error} retry={runs.refresh} /> : data.length ? <RunTable runs={data} /> : <Empty title="Your first experiment starts here" description="Create a draft, validate its configuration, and launch a matched pair."><Button asChild><NavLink to="/experiments">Create experiment</NavLink></Button></Empty>}
        <div className="card-foot">{runs.error ? 'Connection interrupted · last loaded evidence retained' : runs.updatedAt ? `Last refreshed ${new Date(runs.updatedAt).toLocaleTimeString()}` : 'Connecting to researcher API'}</div>
      </Card>
      {!!overview.data?.attention.length && <Card className="mt-5"><CardHeading title="Requires attention" description="Inspect recorded errors and source completeness." /><RunTable runs={overview.data.attention} /></Card>}
    </div><div className="overview-aside"><Card><CardHeading title="A connected research workflow" /><div className="workflow-list">{[
      { n: '01', title: 'Configure a matched pair', text: 'Freeze the same task, agents, and model across conditions.', to: '/experiments' },
      { n: '02', title: 'Follow the source evidence', text: 'Trace execution, board delivery, artifacts, and private memory.', to: '/runs' },
      { n: '03', title: 'Screen, review, compare', text: 'Keep Jev screening, human references, and oversight distinct.', to: '/analysis' },
    ].map(item => <NavLink to={item.to} key={item.n}><span>{item.n}</span><div><strong>{item.title}</strong><p>{item.text}</p></div><ArrowUpRight size={15} aria-hidden="true" /></NavLink>)}</div></Card>
      <Card className="quiet-card"><CardHeading title="Services & recording" /><div className="service-row"><span>Researcher API</span><Badge status={overview.error ? 'failed' : overview.data ? 'completed' : ''}>{overview.error ? 'Stale / disconnected' : overview.data ? 'Connected' : 'Connecting'}</Badge></div><div className="service-row"><span>Experiment capacity</span><strong>{overview.data?.worker.capacity ?? '—'} worker</strong></div><p className="helper">Worker availability: {overview.data?.worker.available === true ? 'available' : overview.data?.worker.available === false ? 'unavailable' : 'unknown'}. {overview.data?.worker.note ?? 'A connection failure does not imply a failed run.'}</p><p className="helper mt-3">Analysis and monitor work use a separate worker. Leaving this page never stops a job.</p></Card>
    </div></div>
    <div className="form-grid mt-5"><ResearchJobs title="Jev analyses" path="/jev/analyses?limit=6" destination="/analysis" /><ResearchJobs title="Monitor evaluations" path="/monitor-evaluations?limit=6" destination="/oversight" /></div>
  </>;
}
