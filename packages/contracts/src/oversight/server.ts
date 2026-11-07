import type { MonitorDefinition, MonitorSettings, Projection } from './contracts.js';

export interface MonitorProvider {
    evaluate(input: { evaluationId: string; projection: Projection; definition: MonitorDefinition; settings: MonitorSettings }): Promise<{ output: unknown; usage?: Record<string, number> }>;
}