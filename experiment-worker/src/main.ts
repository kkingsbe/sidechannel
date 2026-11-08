import { openRuntime } from './harness/runtime.js';
import { workerConcurrency, workerLeaseMs } from './harness/worker-lease.js';
import { runWorker } from './worker.js';

// Validate WORKER_LEASE_MS and WORKER_CONCURRENCY before connecting: a bad setting must fail fast, not after a lease is held.
const leaseMs = workerLeaseMs();
const concurrency = workerConcurrency();

const runtime = await openRuntime();

await runWorker(runtime, { leaseMs, concurrency });
