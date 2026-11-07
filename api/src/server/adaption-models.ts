import type { AdaptionModelCatalog, ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { adaptionModelCapacity } from '@sidechannel/domain/harness/token-budget';

const endpoint = 'https://api.prod.adaptionlabs.ai/api/v1/models?type=hosted';

/** Authenticated availability is joined with documented serving capacity, never guessed from model names. */
export async function getAdaptionModelCatalog(env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch): Promise<AdaptionModelCatalog> {
    const apiKey = env.ADAPTION_API_KEY?.trim();
    if (!apiKey) return { status: 'unavailable', models: [], message: 'Set ADAPTION_API_KEY in the backend environment to discover hosted models.' };
    try {
        const response = await transport(endpoint, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) return { status: 'unavailable', models: [], message: `Adaption model discovery failed: HTTP ${response.status}` };
        const value: unknown = await response.json();
        if (!value || typeof value !== 'object' || !('data' in value) || !Array.isArray(value.data) || !('object' in value) || value.object !== 'list') throw new Error('schema');
        const ids = new Set<string>();
        const models = value.data.map((entry: unknown) => {
            if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(entry.id) || ids.has(entry.id)) throw new Error('schema');
            ids.add(entry.id);
            const capacity = adaptionModelCapacity(entry.id) ?? null;
            const displayName = 'display_name' in entry && typeof entry.display_name === 'string' ? entry.display_name : entry.id;
            return { id: entry.id, displayName, capacity, supportedSettings: ['maxOutputTokens', 'temperature'], launchable: capacity !== null };
        });
        return { status: 'available', models };
    } catch {
        // Do not expose upstream bodies or transport errors that could contain credentials.
        return { status: 'unavailable', models: [], message: 'Adaption hosted-model catalog could not be verified. Check backend connectivity and credentials.' };
    }
}

export async function validateAdaptionModelSelection(config: ExperimentConfig): Promise<string[]> {
    if (config.model?.provider !== 'adaption' || !config.tokenBudget) return [];
    const catalog = await getAdaptionModelCatalog();
    if (catalog.status !== 'available') return [`model.id: ${catalog.message}`];
    const selected = catalog.models.find(model => model.id === config.model.id);
    if (!selected) return ['model.id: Selected direct model is unavailable to the backend Adaption key; refresh the hosted-model catalog.'];
    if (!selected.launchable) return ['tokenBudget.capacity: Serving capacity for this available model is unverified; choose a documented deployment.'];
    return [];
}

export const adaptionModelRoute: ResearchRouteHandler = async request => request.method === 'GET' && request.path === '/models/adaption'
    ? { status: 200, data: await getAdaptionModelCatalog() } : null;
