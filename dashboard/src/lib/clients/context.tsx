import { createContext, useContext, type ReactNode } from 'react';
import { RequesterProvider } from '../api';
import { createJevRequester, createJevSession } from '../adapters/jev';
import { request, type Requester } from '../transport';
import { createRunsClient, type RunsClient } from './runs';
import { createCodebooksClient, type CodebooksClient } from './codebooks';
import { createAnalysesClient, type AnalysesClient } from './analyses';
import { createMonitorClient, createReviewsClient, type MonitorClient, type ReviewsClient } from './monitor';
import { createWorkspaceClient, type WorkspaceClient } from './workspace';

export interface ApiClients {
    request: Requester;
    runs: RunsClient;
    codebooks: CodebooksClient;
    analyses: AnalysesClient;
    monitor: MonitorClient;
    reviews: ReviewsClient;
    workspace: WorkspaceClient;
}

/** Composition root for dashboard data access. Tests inject a fake `request`. */
export function createClients(overrides: { request?: Requester; adapt?: boolean } = {}): ApiClients {
    const session = createJevSession();
    const base = overrides.request ?? request;
    const api = overrides.adapt === false ? base : createJevRequester(base, session);
    return {
        request: api,
        runs: createRunsClient(api),
        codebooks: createCodebooksClient(api),
        analyses: createAnalysesClient(api, session),
        monitor: createMonitorClient(api),
        reviews: createReviewsClient(api),
        workspace: createWorkspaceClient(api),
    };
}

const fallback = createClients();
const ClientsContext = createContext<ApiClients>(fallback);
export const useClients = (): ApiClients => useContext(ClientsContext);

export function ApiClientProvider({ clients, children }: { clients: ApiClients; children: ReactNode }) {
    return (
        <ClientsContext.Provider value={clients}>
            <RequesterProvider value={clients.request}>{children}</RequesterProvider>
        </ClientsContext.Provider>
    );
}
