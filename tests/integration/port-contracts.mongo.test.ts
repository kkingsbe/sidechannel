import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { MongoAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { MongoResearchStore } from '@sidechannel/persistence/analysis/store';
import { harnessRepositoryContract } from './contracts/harness-repository.js';
import { analysisRepositoryContract } from './contracts/analysis-repository.js';
import { researchStoreContract } from './contracts/research-store.js';
import { blobStoreContract } from './contracts/blob-store.js';

const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';
const database = () => 'sidechannel_contract_' + randomUUID().replaceAll('-', '');

harnessRepositoryContract({
    name: 'mongo',
    fixture: async () => {
        const repository = await MongoRepository.connect(uri, database());
        return { repository, dispose: async () => { await repository.db.dropDatabase(); await repository.close(); } };
    },
});

analysisRepositoryContract({
    name: 'mongo',
    fixture: async () => {
        const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
        const db = client.db(database());
        const repository = new MongoAnalysisRepository(client, db);
        await repository.initialize();
        return { repository, dispose: async () => { await db.dropDatabase(); await client.close(); } };
    },
});

researchStoreContract({
    name: 'mongo',
    fixture: async () => {
        const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
        const db = client.db(database());
        const store = new MongoResearchStore(db);
        await store.initialize();
        return { store, dispose: async () => { await db.dropDatabase(); await client.close(); } };
    },
});

blobStoreContract({
    name: 'mongo',
    fixture: async () => {
        const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
        const db = client.db(database());
        const store = new MongoResearchStore(db);
        await store.initialize();
        return { store, dispose: async () => { await db.dropDatabase(); await client.close(); } };
    },
});
