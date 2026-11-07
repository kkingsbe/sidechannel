import { openRuntime } from './harness/runtime.js';
import { runWorker } from './worker.js';

const runtime = await openRuntime();

await runWorker(runtime);
