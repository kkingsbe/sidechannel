import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { buildMetadata } from '@sidechannel/domain/harness/provenance';
import { createResearcherServer } from './server/index.js';
import { createJevExtension } from './routes/jev-extension.js';
import { MongoResearchStore } from '@sidechannel/persistence/analysis/store';
import { createOversightHandler } from './routes/oversight.js';
import { MongoHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { MongoPlaybookCatalog } from '@sidechannel/persistence/playbook/catalog';

const host = process.env.HARNESS_HOST ?? '127.0.0.1';

const port = Number(process.env.HARNESS_PORT ?? 4310);

const repository = await MongoRepository.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', process.env.MONGODB_DB_NAME ?? 'sidechannel');

const researchStore = new MongoResearchStore(repository.db);

await researchStore.initialize();
const healthcareCatalog = new MongoHealthcareCatalog(repository.client, repository.db);
await healthcareCatalog.initialize();
const playbookCatalog = new MongoPlaybookCatalog(repository.db);
await playbookCatalog.initialize();

const server = createResearcherServer(repository, { host, healthcareCatalog, playbookCatalog, token: process.env.RESEARCHER_TOKEN, buildMetadata: await buildMetadata(), extensionHandlers: [await createJevExtension(repository), createOversightHandler(repository, researchStore)] });

server.listen(port, host, () => console.log(`Researcher dashboard: http://${host}:${port}`));

async function stop() { server.close(); await repository.close(); }

process.on('SIGINT', () => void stop());

process.on('SIGTERM', () => void stop());
