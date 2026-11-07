import test from 'node:test';
import { runHealthcareSmoke } from './healthcare-smoke.js';

test('healthcare matched pair launches over HTTP, runs in the worker queue and survives Mongo reload', { timeout: 210000 }, async () => {
    await runHealthcareSmoke();
});
