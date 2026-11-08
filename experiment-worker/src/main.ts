import { openRuntime } from './harness/runtime.js';
import { workerLeaseMs } from './harness/worker-lease.js';
import { runWorker } from './worker.js';

// Validate WORKER_LEASE_MS before connecting: a bad setting must fail fast, not after a lease is held.
const leaseMs = workerLeaseMs();

const runtime = await openRuntime();

await runWorker(runtime, undefined, leaseMs);
