import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { InMemoryPlaybookCatalog } from '@sidechannel/persistence/playbook/catalog';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { HarnessEvent } from '@sidechannel/contracts/harness/contracts';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { createResearcherServer, type ResearcherServerOptions } from './index.js';
import { loadHealthcarePackage } from '../healthcare/bootstrap.js';

export interface RouteRecord {
    readonly case: string;
    readonly status: number;
    readonly contentType: string | null;
    /** Parsed JSON body, normalized; absent for NDJSON responses. */
    readonly body?: unknown;
    /** Parsed NDJSON records, normalized; absent for JSON responses. */
    readonly lines?: unknown[];
}

export interface RouteContractSnapshot {
    readonly research: RouteRecord[];
    readonly demo: RouteRecord[];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

/** Volatile identities and clocks are placeholders; object keys are sorted so key order is not asserted. */
function normalize(value: unknown): unknown {
    if (typeof value === 'string') return value.replace(UUID, '<uuid>').replace(TIMESTAMP, '<timestamp>');
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .map(([key, child]) => [key, normalize(child)] as const)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return value;
}

const healthcareFixture = fileURLToPath(new URL('../../../data/healthcare/points-out/fixture10-s101-points/', import.meta.url));

/**
 * Queue ordering breaks `createdAt` ties by `id` (a random UUID), so runs that must appear
 * in a stable order in `GET /overview` are created at least 2 ms apart.
 */
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 2));

/** An extension stream proves the NDJSON framing and the extension dispatch order. */
const contractExtensions: ResearchRouteHandler = async request => {
    if (request.method !== 'GET') return null;
    if (request.path === '/contract/echo') return { status: 200, data: { method: request.method, value: request.query.get('value') } };
    if (request.path === '/contract/stream') {
        async function* records() { yield { type: 'manifest', data: { schemaVersion: 1 } }; yield { type: 'window', data: { id: 'window-1' } }; }
        return { status: 200, data: records() };
    }
    return null;
};

const playbookReport = { ownActions: 'Read role data.', observations: 'No observations.', limitations: 'Scripted.' };
const playbookTurn = { steps: [{ calls: [{ name: 'read_role_data' }, { name: 'end_turn' }] }] };
/** Deterministic playbook body and the configuration that selects it by id+version only. */
const playbookDocument = (over: Record<string, unknown> = {}) => ({
    format_version: 'sidechannel-playbook-v1', playbook_id: 'contract-play', playbook_version: '1', display_name: 'Route contract playbook',
    scenario_version: 'fixture-v1',
    roles: { alpha: { turns: [playbookTurn], report: playbookReport }, beta: { turns: [playbookTurn], report: playbookReport } },
    ...over,
});
const playbookConfig = () => ({ ...defaultFixtureConfiguration(), model: { provider: 'playbook', id: 'contract-play', settings: { playbookVersion: '1' } } });

async function createApp(options: ResearcherServerOptions, playbookCatalog: InMemoryPlaybookCatalog | null = new InMemoryPlaybookCatalog()) {
    const repository = new InMemoryRepository();
    const directory = await mkdtemp(join(tmpdir(), 'route-contract-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Research workspace</title><main id="root"></main>');
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'assets', 'main.js'), 'document.title="Research workspace"');
    const catalog = new InMemoryHealthcareCatalog();
    await catalog.register(await loadHealthcarePackage(healthcareFixture));
    const server = createResearcherServer(repository, { dashboardDirectory: directory, healthcareCatalog: catalog, ...(playbookCatalog ? { playbookCatalog } : {}), extensionHandlers: [contractExtensions], ...options });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const send = async (label: string, path: string, init?: RequestInit): Promise<RouteRecord> => {
        const response = await fetch(base + path, init);
        const contentType = response.headers.get('content-type');
        const text = await response.text();
        const ndjson = /ndjson/.test(contentType ?? '');
        return {
            case: label, status: response.status, contentType,
            ...(ndjson
                ? { lines: text.trim() ? text.trim().split('\n').map(line => normalize(JSON.parse(line) as unknown)) : [] }
                : { body: text ? normalize(JSON.parse(text) as unknown) : null }),
        };
    };
    const get = (label: string, path: string, headers?: Record<string, string>) => send(label, '/api' + path, headers ? { headers } : undefined);
    const post = (label: string, path: string, payload: unknown, headers?: Record<string, string>) => send(label, '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    const close = async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true }); };
    return { repository, get, post, close };
}

async function recordResearchMode(): Promise<RouteRecord[]> {
    const app = await createApp({});
    const records: RouteRecord[] = [];
    try {
        const config = defaultFixtureConfiguration();
        records.push(await app.get('workspace', '/workspace'));
        records.push(await app.get('config/default', '/config/default'));
        records.push(await app.get('config/schema', '/config/schema'));
        records.push(await app.post('config/validate invalid', '/config/validate', { config: { roles: [null] } }));
        records.push(await app.post('config/validate fixture', '/config/validate', { config }));
        records.push(await app.get('playbooks empty', '/playbooks'));
        records.push(await app.post('playbooks register', '/playbooks', playbookDocument()));
        records.push(await app.get('playbooks list', '/playbooks'));
        records.push(await app.post('playbooks register repeat', '/playbooks', playbookDocument()));
        records.push(await app.post('playbooks register conflict', '/playbooks', playbookDocument({ display_name: 'Changed display name' })));
        const { format_version: omitted, ...malformedPlaybook } = playbookDocument();
        records.push(await app.post('playbooks register malformed', '/playbooks', malformedPlaybook));
        records.push(await app.get('playbooks read', '/playbooks/contract-play?version=1'));
        records.push(await app.get('playbooks read missing version', '/playbooks/contract-play'));
        records.push(await app.get('playbooks read unknown', '/playbooks/missing?version=1'));
        records.push(await app.post('config/validate playbook', '/config/validate', { config: playbookConfig() }));
        const forged = playbookConfig(); Object.assign(forged.model.settings, { playbook: { bogus: true }, playbookHash: 'f'.repeat(64) });
        records.push(await app.post('config/validate playbook forged', '/config/validate', { config: forged }));
        records.push(await app.get('datasets', '/datasets'));
        records.push(await app.get('drafts empty', '/drafts'));
        records.push(await app.post('drafts create invalid', '/drafts', { id: 'draft-1', config: { label: 'unfinished' }, name: 'Pilot', notes: 'Keep my edits' }));
        records.push(await app.post('drafts update', '/drafts', { id: 'draft-1', config, revision: 1 }));
        records.push(await app.post('drafts update stale', '/drafts', { id: 'draft-1', config, revision: 1 }));
        records.push(await app.get('drafts read', '/drafts/draft-1'));
        records.push(await app.get('drafts read missing', '/drafts/missing'));
        records.push(await app.post('drafts duplicate', '/drafts/draft-1/duplicate', { name: 'Second model', notes: 'Pilot' }));
        const run = await app.repository.createRun(createQueuedRun(config, 'seed-run'));
        await pause();
        records.push(await app.post('runs launch', '/runs', { config, idempotencyKey: 'launch-1' }));
        records.push(await app.post('runs launch repeat', '/runs', { config, idempotencyKey: 'launch-1' }));
        const changed = defaultFixtureConfiguration(); changed.label = 'edited';
        records.push(await app.post('runs launch conflict', '/runs', { config: changed, idempotencyKey: 'launch-1' }));
        records.push(await app.post('runs launch no key', '/runs', { config }));
        records.push(await app.post('runs launch invalid config', '/runs', { config: { roles: [null] }, idempotencyKey: 'launch-2' }));
        records.push(await app.post('runs duplicate', '/runs/' + run.id + '/duplicate', { name: 'Copy' }));
        await pause();
        const pair = await app.post('pairs launch', '/pairs', { config, idempotencyKey: 'pair-1', pairingSeed: 7 });
        records.push(pair);
        records.push(await app.get('pairs compare', '/pairs/pair-pair-1'));
        records.push(await app.get('pairs compare missing', '/pairs/pair-missing'));
        records.push(await app.post('pairs duplicate', '/pairs/pair-pair-1/duplicate', { name: 'Pair copy' }));
        const appended: HarnessEvent[] = [];
        for (const [index, type] of ['turn_started', 'model_response', 'memory_updated'].entries()) appended.push(await app.repository.appendEvent({ runId: run.id, type, agentId: index % 2 ? 'beta' : 'alpha', data: { index } }));
        records.push(await app.get('runs list all', '/runs'));
        records.push(await app.get('runs list page', '/runs?limit=1&offset=0'));
        records.push(await app.get('runs list cursor invalid', '/runs?limit=0'));
        records.push(await app.get('runs read', '/runs/' + run.id));
        records.push(await app.get('runs read missing', '/runs/missing'));
        records.push(await app.get('runs progress', '/runs/' + run.id + '/progress'));
        records.push(await app.get('runs events page', '/runs/' + run.id + '/events?limit=2'));
        records.push(await app.get('runs events phase invalid', '/runs/' + run.id + '/events?phase=nope'));
        records.push(await app.get('runs event item', '/runs/' + run.id + '/events/' + appended[0]!.id));
        records.push(await app.get('runs event item missing', '/runs/' + run.id + '/events/missing'));
        records.push(await app.get('runs event item other run', '/runs/other-run/events/' + appended[0]!.id));
        records.push(await app.get('runs memory page', '/runs/' + run.id + '/memory?limit=1'));
        records.push(await app.get('runs artifacts page', '/runs/' + run.id + '/artifacts?limit=1'));
        records.push(await app.get('runs artifact item', '/runs/' + run.id + '/artifacts/0'));
        records.push(await app.get('runs artifact missing', '/runs/' + run.id + '/artifacts/99'));
        records.push(await app.get('runs board page', '/runs/' + run.id + '/board?limit=1'));
        records.push(await app.get('runs export', '/runs/' + run.id + '/export'));
        records.push(await app.get('runs unknown op falls back to export shape', '/runs/' + run.id + '/cancel'));
        records.push(await app.post('runs cancel', '/runs/' + run.id + '/cancel', {}));
        records.push(await app.get('overview', '/overview'));
        records.push(await app.get('unknown api route', '/nope'));
        records.push(await app.post('cross origin write', '/runs', { config, idempotencyKey: 'cross-origin' }, { Origin: 'https://elsewhere.example' }));
        records.push(await app.get('extension echo', '/contract/echo?value=connected'));
        records.push(await app.get('extension stream', '/contract/stream'));
    } finally { await app.close(); }
    return records;
}

async function recordDemoMode(): Promise<RouteRecord[]> {
    // No playbook catalog is injected here, so the missing-catalog failure path is characterized too.
    const app = await createApp({ demoMode: true }, null);
    try {
        return [
            await app.get('workspace demo', '/workspace'),
            await app.post('config/validate playbook catalog unavailable', '/config/validate', { config: playbookConfig() }),
        ];
    } finally { await app.close(); }
}

export async function recordRouteContract(): Promise<RouteContractSnapshot> {
    return { research: await recordResearchMode(), demo: await recordDemoMode() };
}
