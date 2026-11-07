import { harnessRepositoryContract } from './contracts/harness-repository.js';
import { analysisRepositoryContract } from './contracts/analysis-repository.js';
import { researchStoreContract } from './contracts/research-store.js';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';

harnessRepositoryContract({
    name: 'memory',
    fixture: async () => ({ repository: new InMemoryRepository(), dispose: async () => {} }),
});

analysisRepositoryContract({
    name: 'memory',
    fixture: async () => ({ repository: new InMemoryAnalysisRepository(), dispose: async () => {} }),
});

researchStoreContract({
    name: 'memory',
    fixture: async () => ({ store: new InMemoryResearchStore(), dispose: async () => {} }),
});
