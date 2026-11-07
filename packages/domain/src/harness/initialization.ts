import { createHash, randomUUID } from 'node:crypto';
import type { ExperimentConfig, Run } from '@sidechannel/contracts/harness/contracts';
import type { Scenario } from '@sidechannel/contracts/harness/server';
import { initializeInstalledScenario, initialScenarioArtifact } from './scenario-initialization.js';

export function createQueuedRun(config: ExperimentConfig, launchKey: string, pairId?: string, scenario: Pick<Scenario, 'initialize' | 'initialArtifact'> = { initialize: initializeInstalledScenario, initialArtifact: initialScenarioArtifact }): Run { const now = new Date().toISOString(); return { id: randomUUID(), launchKey, configHash: createHash('sha256').update(JSON.stringify(config)).digest('hex'), pairId, config: structuredClone(config), status: 'queued', createdAt: now, updatedAt: now, round: 0, turn: 0, board: [], artifacts: [{ version: 0, previousVersion: null, authorId: null, value: scenario.initialArtifact?.(config) ?? initialScenarioArtifact(config), operationId: 'initialize', frozen: false }], reports: [], operations: {}, scenarioState: scenario.initialize(config), usage: {} }; }
