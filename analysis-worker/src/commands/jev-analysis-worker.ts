import { MongoClient } from 'mongodb';
import { MongoAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { AnalysisWorker } from '../jev/jev-worker.js';

// This process intentionally imports no Mastra runtime or experiment-worker guard.
const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', { serverSelectionTimeoutMS: 5000 });

await client.connect();

const repository = new MongoAnalysisRepository(client, client.db(process.env.MONGODB_DB_NAME ?? 'sidechannel'));

await repository.initialize();

const stopping = new AbortController();

process.on('SIGINT', () => stopping.abort());
 process.on('SIGTERM', () => stopping.abort());

console.log('Jev analysis worker ready; recoverable analysis leases are independent of experiment execution.');

try { await new AnalysisWorker(repository).run(stopping.signal); } finally { await client.close(); }