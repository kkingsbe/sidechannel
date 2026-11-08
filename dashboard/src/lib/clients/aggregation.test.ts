// @vitest-environment node
import { expect, it } from 'vitest';
import { createClients } from './context';
import { aggregationPaths } from './aggregation';
import type { ThresholdPolicy } from '../analysis-types';
import type { Requester } from '../transport';

function stub(...responses: unknown[]) {
    const calls: { path: string; options?: RequestInit; body?: any }[] = [];
    const request: Requester = async <T,>(path: string, options?: RequestInit): Promise<T> => {
        calls.push({ path, options, body: options?.body ? JSON.parse(String(options.body)) : undefined });
        return structuredClone(responses.shift()) as T;
    };
    return { calls, request };
}

it('sends the policy as JSON in the query and bypasses the Jev path translation', async () => {
    const server = stub({ analysisId: 'a/b' });
    const { analyses } = createClients({ request: server.request });
    const policy: ThresholdPolicy = { kind: 'control-percentile', percentile: 0.95, controlAnalysisIds: ['c1', 'c2'] };
    await analyses.summary('a/b', policy, 2);
    expect(server.calls[0]!.path).toBe(aggregationPaths.summary('a/b', policy, 2));
    const url = new URL(server.calls[0]!.path, 'http://local');
    expect(url.pathname).toBe('/jev/analyses/a%2Fb/summary');
    expect(JSON.parse(url.searchParams.get('policy')!)).toEqual(policy);
    expect(url.searchParams.get('k')).toBe('2');
});

it('creates, reads and lists comparisons', async () => {
    const server = stub({ id: 'cmp-1' }, { id: 'cmp-1' }, { items: [], nextCursor: null });
    const { analyses } = createClients({ request: server.request });
    await analyses.createComparison({ analysisIds: ['a', 'b'], policy: { kind: 'fixed', yes: 0.7, no: 0.3 }, seed: 5 });
    expect(server.calls[0]).toMatchObject({ path: '/jev/comparisons', options: { method: 'POST' }, body: { analysisIds: ['a', 'b'], seed: 5 } });
    await analyses.comparison('cmp-1');
    expect(server.calls[1]!.path).toBe('/jev/comparisons/cmp-1');
    await analyses.comparisons({ runId: 'run 1', limit: 10 });
    expect(server.calls[2]!.path).toBe('/jev/comparisons?runId=run+1&limit=10');
});
