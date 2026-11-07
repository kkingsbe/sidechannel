import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlaybook } from '@sidechannel/domain/playbook/package';
import { InMemoryPlaybookCatalog } from './catalog.js';

const turn = { steps: [{ calls: [{ name: 'read_role_data' }, { name: 'end_turn' }] }] }, report = { ownActions: 'a', observations: 'o', limitations: 'l' };
const make = (over: Record<string, unknown> = {}) => validatePlaybook({ format_version: 'sidechannel-playbook-v1', playbook_id: 'demo', playbook_version: '1', display_name: 'Demo', scenario_version: 'fixture-v1', roles: { alpha: { turns: [turn], report }, beta: { turns: [turn, turn], report } }, ...over });

test('register is idempotent, immutable and ignores caller-supplied hash and bytes', async () => {
    const catalog = new InMemoryPlaybookCatalog(), value = make(), first = await catalog.register({ ...value, playbookHash: 'x'.repeat(64), playbookBytes: 'bogus' });
    assert.equal(first.playbookHash, value.playbookHash); assert.deepEqual(first.roles, ['alpha', 'beta']); assert.equal(first.rounds, 2);
    assert.deepEqual(await catalog.register(value), first);
    await assert.rejects(catalog.register(make({ display_name: 'Changed' })), /Immutable playbook identity conflicts/);
    assert.deepEqual(await catalog.get('demo', '1'), value);
});
test('list is sorted by display name, id and version; get returns null for unknown identities', async () => {
    const catalog = new InMemoryPlaybookCatalog();
    await catalog.register(make({ playbook_id: 'b', display_name: 'Zed' })); await catalog.register(make({ playbook_id: 'a', playbook_version: '2', display_name: 'Alpha' })); await catalog.register(make({ playbook_id: 'a', playbook_version: '1', display_name: 'Alpha' }));
    assert.deepEqual((await catalog.list()).map(i => `${i.playbookId}:${i.playbookVersion}`), ['a:1', 'a:2', 'b:1']);
    assert.equal(await catalog.get('a', '3'), null);
});
test('register rejects structurally invalid playbooks', async () => {
    await assert.rejects(new InMemoryPlaybookCatalog().register({ ...make(), playbook: { nope: true } as never }), /Invalid playbook/);
});
