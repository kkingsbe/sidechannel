import { fixtureDescriptor } from './fixture.js';
import { healthcareDescriptor } from './healthcare.js';
import type { ScenarioDescriptor, ScenarioPresentation } from './descriptor.js';

export { EVIDENCE_TABS } from './descriptor.js';
export type { ScenarioDescriptor, ScenarioPresentation } from './descriptor.js';
export { ScenarioValidationError } from './scenario-error.js';
export { FIXTURE_SCENARIO_VERSION, FIXTURE_TOOLS, fixtureDescriptor, fixtureScenario, initializeFixtureScenario } from './fixture.js';
export { HEALTHCARE_REQUIRED_TOOLS, HEALTHCARE_TOOLS, healthcareDescriptor, healthcareScenario } from './healthcare.js';

export const SCENARIOS: Record<string, ScenarioDescriptor> = {
    [fixtureDescriptor.version]: fixtureDescriptor,
    [healthcareDescriptor.version]: healthcareDescriptor,
};

export function scenarioDescriptor(version: string): ScenarioDescriptor | undefined { return SCENARIOS[version]; }

export function installedScenarioVersions(): string[] { return Object.keys(SCENARIOS); }

export function scenarioCatalog(): { version: string; label: string; fixture: boolean; artifactSchemaVersion: string; presentation: ScenarioDescriptor['presentation'] }[] {
    return Object.values(SCENARIOS).map(descriptor => ({
        version: descriptor.version,
        label: descriptor.label,
        fixture: descriptor.fixture,
        artifactSchemaVersion: descriptor.artifactSchemaVersion,
        // Copies keep the payload mutable for JSON transport and immutable at the registry.
        presentation: { ...descriptor.presentation, tabs: [...descriptor.presentation.tabs] },
    }));
}
