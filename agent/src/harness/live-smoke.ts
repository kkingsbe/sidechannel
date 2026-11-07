import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { MastraModelAdapter, createMongoMemory, memoryIdentity } from './mastra-adapter.js';
import { configureExperimentRuntime, closeExperimentRuntime, flushExperimentTraces } from '../mastra/index.js';
import type { ModelInput, MemorySnapshot } from './contracts.js';
import { adaptionBaseUrl, resolveInferenceProvider } from './inference-provider.js';
// Deliberately no default model: the caller chooses an exact available model.
const [provider, modelId] = process.argv.slice(2);
if (!provider || !modelId)
    throw new Error('Usage: npx tsx src/harness/live-smoke.ts <provider> <exact-model-id>');
if (provider === 'adaption') {
    resolveInferenceProvider({ provider, id: modelId, settings: {} });
    const response = await fetch(`${adaptionBaseUrl}/models?type=hosted`, {
        headers: { Authorization: `Bearer ${process.env.ADAPTION_API_KEY!.trim()}` },
        signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
        throw new Error(`Adaption model discovery failed: HTTP ${response.status}`);
    const catalog = await response.json() as { data: { id: string }[] };
    if (!catalog.data.some(model => model.id === modelId))
        throw new Error('Exact model is absent from the Adaption catalog available to this key');
} else {
    const agentRoot = fileURLToPath(new URL('../../', import.meta.url));
    execFileSync(process.execPath, [fileURLToPath(new URL('../../.claude/skills/mastra/scripts/provider-registry.mjs', import.meta.url)), '--provider', provider], { cwd: agentRoot, stdio: 'ignore' });
    const registry = JSON.parse(await readFile(new URL('../../node_modules/@mastra/core/dist/provider-registry.json', import.meta.url), 'utf8'));
    const entry = registry.providers[provider];
    if (!entry?.models.includes(modelId))
        throw new Error('Exact model is absent from installed provider registry');
    if (entry.apiKeyEnvVar && !process.env[entry.apiKeyEnvVar])
        throw new Error(`Missing required credential environment variable ${entry.apiKeyEnvVar}`);
}
const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';
const dbName = process.env.MASTRA_DB_NAME ?? 'sidechannel_mastra';
configureExperimentRuntime(uri, dbName);
const memory = createMongoMemory(uri, dbName);
const runId = `live-smoke-${crypto.randomUUID()}`;
const agentId = 'fixture-smoke';
try {
    const snapshot: MemorySnapshot = { version: 1, notes: '# Notes\nSynthetic continuity marker: cobalt-seven\n# Next steps\n',
        messages: [{ role: 'user' as const, content: 'This is a synthetic infrastructure smoke test.' }] };
    await memory.save(runId, agentId, snapshot);
    const saved = await memory.load(runId, agentId);
    assert.deepEqual(saved, snapshot);
    assert.equal((await memory.load(`${runId}-fresh`, agentId)).version, 0);
    const input: ModelInput = { ...memoryIdentity(runId, agentId), runId, agentId, invocationId: `${runId}:inference`,
        phase: 'report', model: { provider, id: modelId, settings: process.env.SMOKE_MODEL_SETTINGS ? JSON.parse(process.env.SMOKE_MODEL_SETTINGS) : { maxOutputTokens: 256 } },
        messages: [{ role: 'system', content: `Private notes:\n${saved.notes}` }, ...saved.messages,
            { role: 'user', content: 'Reply with the synthetic continuity marker in your private notes. No tools are available.' }],
        tools: [], timeoutMs: 60000 };
    const response = await new MastraModelAdapter().complete(input);
    assert.equal(response.toolCalls.length, 0);
    assert.ok(response.text.length > 0);
    assert.ok(response.text.includes('cobalt-seven'));
    saved.messages.push({ role: 'assistant', content: response.text });
    await memory.save(runId, agentId, saved);
    assert.deepEqual(await memory.load(runId, agentId), saved);
    await flushExperimentTraces();
    // No provider request, headers, raw responses, credential values or notes are printed.
    console.log(JSON.stringify({ kind: 'live-provider-smoke', runId, provider, modelId,
        responseReceived: true, memoryPersisted: true, usage: response.usage, trace: response.trace }));
}
finally {
    await memory.storage.close();
    await closeExperimentRuntime();
}
