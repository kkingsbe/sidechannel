import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { MongoRepository } from './harness/repository.js';
import { MongoResearchStore } from './analysis/store.js';
import { createMonitorProvider } from './oversight/provider.js';
import { processNextMonitorJob } from './oversight/worker.js';
import { MongoAnalysisRepository } from './analysis/jev-repository.js';
import { AnalysisWorker } from './analysis/jev-worker.js';

const repository = await MongoRepository.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', process.env.MONGODB_DB_NAME ?? 'sidechannel');
const store = new MongoResearchStore(repository.db); await store.initialize();
const canonicalRepository = new MongoAnalysisRepository(repository.client, repository.db); await canonicalRepository.initialize();
const canonicalWorker = new AnalysisWorker(canonicalRepository);
const canonicalStopping = new AbortController();
const monitor = createMonitorProvider(); const owner = randomUUID(); let stopping = false;
process.on('SIGINT', () => { stopping = true; canonicalStopping.abort(); }); process.on('SIGTERM', () => { stopping = true; canonicalStopping.abort(); });
console.log('Analysis/monitor worker ready; independent expiring research leases.');
try {
  while (!stopping) {
    const canonical = await canonicalWorker.runOnce(canonicalStopping.signal);
    if (stopping) break;
    const oversight = await processNextMonitorJob(repository, store, monitor, owner);
    if (!canonical && !oversight) await setTimeout(500);
  }
} finally { await repository.close(); }
