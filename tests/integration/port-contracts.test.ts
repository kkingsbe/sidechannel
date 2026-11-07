import { harnessRepositoryContract } from './contracts/harness-repository.js';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';

harnessRepositoryContract({
    name: 'memory',
    fixture: async () => ({ repository: new InMemoryRepository(), dispose: async () => {} }),
});
