/**
 * Public harness adapter path. The adapters live in `./memory/` and `./mongo/`; this module
 * re-exports them so `@sidechannel/persistence/harness/repository` keeps resolving.
 */
export { InMemoryRepository } from './memory/repository.js';
export { MongoRepository } from './mongo/repository.js';
