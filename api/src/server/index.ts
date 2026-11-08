import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import type { PlaybookCatalog } from '@sidechannel/contracts/playbook/repository';
import type { RunDependencyReader, RunRecordPurger } from '@sidechannel/contracts/harness/run-lifecycle';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { healthcareRunPurger, RunLifecycleService } from '@sidechannel/domain/harness/run-lifecycle';
import { HealthcareService } from '../healthcare/service.js';
import { PlaybookService } from '../playbook/service.js';
import { adaptionModelRoute } from './adaption-models.js';
import { requireSameOrigin, requireToken } from './auth.js';
import { createConfigurationPipeline } from './configuration.js';
import { HttpError, sendFailure } from './errors.js';
import { DEFAULT_EVENT_STREAM_TIMING, eventStreamRoute, streamRunEvents, type EventStreamTiming } from './event-stream.js';
import { applySecurityHeaders, requestBody, send } from './http.js';
import { createLaunchService } from './launch.js';
import { createConfigRouter } from './routers/config.js';
import { createDraftsRouter } from './routers/drafts.js';
import { createOverviewRouter } from './routers/overview.js';
import { createMetadataRouter } from './routers/metadata.js';
import { createPairsRouter } from './routers/pairs.js';
import { createPlaybookRouter } from './routers/playbook.js';
import { createRunLifecycleRouter } from './routers/run-lifecycle.js';
import { createRunsRouter } from './routers/runs.js';
import { createWorkspaceRouter } from './routers/workspace.js';
import { serveDashboard } from './static.js';

export type { Draft } from '@sidechannel/contracts/harness/repository';

export interface ResearcherServerOptions {
    /** Explicitly identifies the simulated, reset-on-restart acceptance workspace. */
    demoMode?: boolean;
    token?: string;
    host?: string;
    buildMetadata?: ExperimentConfig['build'];
    extensionHandlers?: ResearchRouteHandler[];
    dashboardDirectory?: string;
    /** Live event stream timing; tests shorten it. */
    eventStream?: EventStreamTiming;
    healthcareCatalog?: HealthcareCatalog;
    playbookCatalog?: PlaybookCatalog;
    /** Records that cite a run (analyses, reviews, monitor evaluations); any of them blocks deleting it. Omitted only by compositions that have none. */
    runDependencies?: RunDependencyReader;
    /** Run-keyed stores outside the harness collections (Mastra memory and traces). The healthcare catalog is purged automatically. */
    runPurgers?: RunRecordPurger[];
}

export function createResearcherServer(repository: ResearcherRepository, options: ResearcherServerOptions = {}): Server {
    const healthcare = options.healthcareCatalog ? new HealthcareService(options.healthcareCatalog) : undefined;
    const playbooks = options.playbookCatalog ? new PlaybookService(options.playbookCatalog) : undefined;
    const configuration = createConfigurationPipeline({ buildMetadata: options.buildMetadata, healthcare, playbook: playbooks });
    const launch = createLaunchService({ repository, pipeline: configuration, healthcare });
    const lifecycle = new RunLifecycleService({ runs: repository, dependencies: options.runDependencies, purgers: [...(options.healthcareCatalog ? [healthcareRunPurger(options.healthcareCatalog)] : []), ...(options.runPurgers ?? [])] });
    const routers: ResearchRouteHandler[] = [
        createWorkspaceRouter({ demoMode: options.demoMode }),
        createConfigRouter(configuration),
        createDraftsRouter({ repository, pipeline: configuration }),
        createRunLifecycleRouter(lifecycle),
        createRunsRouter({ repository, pipeline: configuration, launch, healthcare }),
        createPairsRouter({ repository, pipeline: configuration, launch }),
        createOverviewRouter(repository),
        createMetadataRouter(),
        adaptionModelRoute,
        ...(healthcare ? [healthcare.routes(repository)] : []),
        ...(playbooks ? [createPlaybookRouter(playbooks.catalog)] : []),
        ...(options.extensionHandlers ?? []),
    ];
    const dashboardDirectory = options.dashboardDirectory ?? process.env.DASHBOARD_DIST_DIR ?? fileURLToPath(new URL('../../../dashboard/dist/', import.meta.url));
    return createServer(async (req, res) => {
        try {
            applySecurityHeaders(res);
            const url = new URL(req.url || '/', 'http://localhost');
            if (!url.pathname.startsWith('/api/')) return await serveDashboard(req, res, url.pathname, dashboardDirectory);
            requireToken(req, options.token);
            requireSameOrigin(req);
            const request = { method: req.method ?? 'GET', path: url.pathname.slice(4), query: url.searchParams, body: requestBody(req) };
            // Raw-write seam: the live event stream is the one response a router cannot produce, because the
            // transport-neutral contract only returns JSON results. It is matched here, before JSON dispatch.
            const resume = req.headers['last-event-id'];
            const stream = request.method === 'GET' ? await eventStreamRoute(repository, request.path, request.query, typeof resume === 'string' ? resume : undefined) : null;
            if (stream) return await streamRunEvents(res, repository, stream.runId, stream.query, options.eventStream ?? DEFAULT_EVENT_STREAM_TIMING);
            for (const router of routers) { const result = await router(request); if (result) return await send(res, result.status, result.data, result.headers); }
            throw new HttpError(404, 'API route not found');
        } catch (error) { await sendFailure(res, error); }
    });
}
