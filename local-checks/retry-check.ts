// Local check for the gateway retry in experiment-worker/src/harness/inference-gateway.ts (not part of Kyle's code).
import { readFileSync } from 'node:fs';
import { InferenceGateway } from '../experiment-worker/src/harness/inference-gateway.ts';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const run: any = { config, usage: {} };
const ok = { text: 'done', toolCalls: [], usage: { outputTokens: 5 } };

async function trial(name: string, failures: string[]) {
    const events: string[] = [];
    let calls = 0;
    const adapter: any = { complete: async () => { calls++; if (calls <= failures.length) throw new Error(failures[calls - 1]); return ok; } };
    const recorder: any = { evidenceFailed: false, emit: async (type: string) => { events.push(type); return {}; }, persist: async () => { } };
    const gw = new InferenceGateway({ runId: 'check', run, adapter, recorder, checkpoint: async () => { }, startedAt: Date.now() });
    const input: any = { runId: 'check', agentId: 'a', threadId: 't', resourceId: 'r', invocationId: 'i', phase: 'action', model: config.model, messages: [{ role: 'user', content: 'hi' }], tools: [], timeoutMs: 5000 };
    let outcome = 'returned';
    try { await gw.infer(input); } catch (e: any) { outcome = 'threw: ' + e.message; }
    const retries = events.filter(e => e === 'model_retry').length;
    console.log(`${name}: model calls ${calls}, retries logged ${retries}, responses logged ${events.filter(e => e === 'model_response').length}, ${outcome}`);
    return { calls, retries, outcome };
}

const a = await trial('fails once with Gateway Time-out', ['Gateway Time-out']);
const b = await trial('fails 3 times with Gateway Time-out', ['Gateway Time-out', 'Gateway Time-out', 'Gateway Time-out']);
const c = await trial('fails with a non-gateway error', ['Unparseable model response']);
const d = await trial('fails twice with 502 Bad Gateway, then answers', ['502 Bad Gateway', 'Bad Gateway']);
const pass = a.calls === 2 && a.retries === 1 && a.outcome === 'returned'
    && b.calls === 3 && b.retries === 2 && b.outcome.startsWith('threw: Gateway')
    && c.calls === 1 && c.retries === 0 && c.outcome.startsWith('threw')
    && d.calls === 3 && d.retries === 2 && d.outcome === 'returned';
console.log(pass ? 'ALL PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
