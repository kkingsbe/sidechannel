import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryPlaybookCatalog } from '@sidechannel/persistence/playbook/catalog';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { validatePlaybook } from '@sidechannel/domain/playbook/package';
import type { ExperimentConfig, Run } from '@sidechannel/contracts/harness/contracts';
import { createResearcherServer } from '../server/index.js';

const turn = { steps: [{ calls: [{ name: 'read_role_data' }, { name: 'post_board', arguments: { text: 'hi' } }, { name: 'end_turn' }] }] };
const report = { ownActions: 'Posted a note.', observations: 'Saw my fragment.', limitations: 'Scripted.' };
const playbook = (over: Record<string, unknown> = {}) => ({ format_version: 'sidechannel-playbook-v1', playbook_id: 'demo-play', playbook_version: '1', display_name: 'Demo playbook', scenario_version: 'fixture-v1', roles: { alpha: { turns: [turn], report }, beta: { turns: [turn], report } }, ...over });
const configFor = (id = 'demo-play', extra: Record<string, unknown> = {}): ExperimentConfig => ({ ...defaultFixtureConfiguration(), model: { provider: 'playbook', id, settings: { playbookVersion: '1', ...extra } } });
async function setup(withCatalog = true) {
    const repository = new InMemoryRepository(), catalog = new InMemoryPlaybookCatalog();
    const server = createResearcherServer(repository, withCatalog ? { playbookCatalog: catalog } : {}); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
    const url = (path: string) => `http://127.0.0.1:${address.port}/api${path}`;
    const get = (path: string) => fetch(url(path));
    const post = (path: string, value: unknown) => fetch(url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    return { repository, catalog, get, post, close: async () => { const closed = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await closed; } };
}

test('upload, list, fetch, idempotent re-upload, conflict, malformed and unknown playbooks', async () => {
    const app = await setup(); try {
        const upload = await app.post('/playbooks', playbook()); assert.equal(upload.status, 201, await upload.clone().text()); const item = await upload.json();
        assert.match(item.playbookHash, /^[0-9a-f]{64}$/); assert.deepEqual(item.roles, ['alpha', 'beta']); assert.equal(item.rounds, 1);
        assert.deepEqual(await (await app.get('/playbooks')).json(), [item]);
        const fetched = await (await app.get('/playbooks/demo-play?version=1')).json(); assert.deepEqual(fetched.item, item); assert.equal(fetched.playbook.display_name, 'Demo playbook');
        const again = await app.post('/playbooks', playbook()); assert.equal(again.status, 201); assert.deepEqual(await again.json(), item);
        const changed = await app.post('/playbooks', playbook({ display_name: 'Changed' })); assert.equal(changed.status, 409); assert.match((await changed.json()).error, /Immutable playbook/);
        const { format_version: _omitted, ...malformed } = playbook(); const bad = await app.post('/playbooks', malformed); assert.equal(bad.status, 400); assert.match((await bad.json()).error, /format_version/);
        assert.equal((await app.get('/playbooks/missing?version=1')).status, 404); assert.equal((await app.get('/playbooks/demo-play?version=9')).status, 404); assert.equal((await app.get('/playbooks/demo-play')).status, 400);
        assert.equal((await app.catalog.list()).length, 1);
    } finally { await app.close(); }
});
test('validation embeds the registered playbook and rejects unknown ids, study phase and browser-supplied content', async () => {
    const app = await setup(); try {
        const registered = await app.catalog.register(validatePlaybook(playbook()));
        const valid = await (await app.post('/config/validate', { config: configFor() })).json(); assert.equal(valid.valid, true, JSON.stringify(valid));
        assert.deepEqual(valid.config.model.settings.playbook, playbook()); assert.equal(valid.config.model.settings.playbookHash, registered.playbookHash);
        const forged = await (await app.post('/config/validate', { config: configFor('demo-play', { playbook: { bogus: true }, playbookHash: 'f'.repeat(64) }) })).json(); assert.equal(forged.valid, true, JSON.stringify(forged));
        assert.deepEqual(forged.config.model.settings.playbook, playbook()); assert.equal(forged.config.model.settings.playbookHash, registered.playbookHash);
        const wrong = await (await app.post('/config/validate', { config: configFor('other-play') })).json(); assert.equal(wrong.valid, false); assert('model.id' in wrong.fieldErrors);
        const noVersion = configFor(); delete (noVersion.model.settings as Record<string, unknown>).playbookVersion; const missing = await (await app.post('/config/validate', { config: noVersion })).json(); assert.equal(missing.valid, false); assert('model.settings.playbookVersion' in missing.fieldErrors);
        const study = await (await app.post('/config/validate', { config: { ...configFor(), phase: 'study' } })).json(); assert.equal(study.valid, false); assert('phase' in study.fieldErrors);
    } finally { await app.close(); }
});
test('pair launch embeds identical registered content in both runs; no catalog fails on model.id', async () => {
    const app = await setup(); try {
        await app.post('/playbooks', playbook());
        const response = await app.post('/pairs', { config: configFor('demo-play', { playbook: { bogus: true } }), idempotencyKey: 'play-pair' }); assert.equal(response.status, 202, await response.clone().text()); const pair = await response.json() as Run[];
        assert.equal(pair.length, 2); for (const run of pair) { assert.deepEqual(run.config.model.settings.playbook, playbook()); assert.match(String(run.config.model.settings.playbookHash), /^[0-9a-f]{64}$/); }
        assert.deepEqual({ ...pair[0]!.config, condition: null }, { ...pair[1]!.config, condition: null });
    } finally { await app.close(); }
    const bare = await setup(false); try {
        const validation = await (await bare.post('/config/validate', { config: configFor() })).json(); assert.equal(validation.valid, false); assert.match(validation.fieldErrors['model.id'], /Playbook catalog is unavailable/);
        assert.equal((await bare.post('/pairs', { config: configFor(), idempotencyKey: 'none' })).status, 400);
    } finally { await bare.close(); }
});
