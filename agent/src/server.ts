import { MongoRepository } from './harness/repository.js';
import { buildMetadata } from './harness/provenance.js';
import { createResearcherServer } from './server/index.js';
import { createJevExtension } from './analysis/jev-extension.js';
import { MongoResearchStore } from './analysis/store.js';
import { createOversightHandler } from './oversight/api.js';
const host = process.env.HARNESS_HOST ?? '127.0.0.1';
const port = Number(process.env.HARNESS_PORT ?? 4310);
const repository = await MongoRepository.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', process.env.MONGODB_DB_NAME ?? 'sidechannel');
const researchStore = new MongoResearchStore(repository.db);
await researchStore.initialize();
const server = createResearcherServer(repository, { host, token: process.env.RESEARCHER_TOKEN, buildMetadata: await buildMetadata(), extensionHandlers: [await createJevExtension(repository), createOversightHandler(repository, researchStore)] });
server.listen(port, host, () => console.log(`Researcher dashboard: http://${host}:${port}`));
async function stop() { server.close(); await repository.close(); }
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
