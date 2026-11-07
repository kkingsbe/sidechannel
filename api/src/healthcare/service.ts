import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { Repository } from '@sidechannel/contracts/harness/server';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { resolveHealthcareConfiguration } from './resolver.js';
import { healthcareRouteHandler } from './routes.js';
import { freezeHealthcareReference, healthcareResearcherExport } from './provenance.js';

/** Facade kept for `createResearcherServer`; each method delegates to one responsibility module. */
export class HealthcareService {
    constructor(readonly catalog: HealthcareCatalog) { }
    resolveConfiguration(input: unknown): Promise<unknown> { return resolveHealthcareConfiguration(this.catalog, input); }
    freezeRunReference(run: Run): Promise<void> { return freezeHealthcareReference(this.catalog, run); }
    researcherExport(run: Run, repository: Pick<Repository, 'getRun'>) { return healthcareResearcherExport(this.catalog, repository, run); }
    routes(repository: Pick<Repository, 'getRun'>): ResearchRouteHandler { return healthcareRouteHandler(this.catalog, repository); }
}
