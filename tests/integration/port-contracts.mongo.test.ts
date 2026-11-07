import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoResearchStore } from '@sidechannel/persistence/analysis/store';
import { researchStoreContract } from './contracts/research-store.js';

const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';

researchStoreContract({
    name: 'mongo',
    fixture: async () => {
        const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
        const db = client.db('sidechannel_contract_' + randomUUID().replaceAll('-', ''));
        const store = new MongoResearchStore(db);
        await store.initialize();
        return { store, dispose: async () => { await db.dropDatabase(); await client.close(); } };
    },
});
