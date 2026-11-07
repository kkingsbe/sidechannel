import type { HostedModelPolicy, ProviderProfile } from './profile.js';
import { adaptionHostedPolicy, adaptionProvider } from './adaption.js';
import { genericProvider } from './generic.js';

export type { HostedModelPolicy, ProviderProfile, ResolvedTransport, TransportModel } from './profile.js';
export { ADAPTION_MODEL_ENDPOINT, adaptionBaseUrl, adaptionProvider } from './adaption.js';
export { genericProvider } from './generic.js';

/** The fixture driver is the generic transport with scripted usage provenance. */
export const scriptedProvider: ProviderProfile = { ...genericProvider, id: 'scripted', label: 'Scripted driver', usageSource: 'scripted', fixture: true };

/** Registry identity for providers without a dedicated profile (falls back to `generic`). */
const FALLBACK_PROVIDER_ID = genericProvider.id;

export const PROVIDERS: Record<string, ProviderProfile> = {
    [genericProvider.id]: genericProvider,
    [scriptedProvider.id]: scriptedProvider,
    [adaptionProvider.id]: adaptionProvider,
};

export function providerProfile(id: string): ProviderProfile { return PROVIDERS[id] ?? genericProvider; }

export const HOSTED_POLICIES: Record<string, HostedModelPolicy> = { [adaptionProvider.id]: adaptionHostedPolicy };

export function hostedPolicy(id: string): HostedModelPolicy | undefined { return HOSTED_POLICIES[id]; }

export function usageSource(providerId: string): ProviderProfile['usageSource'] { return providerProfile(providerId).usageSource; }

/**
 * Every registered provider except the fallback identity. Derived from `PROVIDERS`
 * rather than a second list, so a test-only registration appears in the catalog with
 * zero production edits (the OCP seam), and `generic` stays a fallback, not a choice.
 */
export function providerCatalog(): { id: string; label: string; settings: string[]; fixture: boolean }[] {
    return Object.values(PROVIDERS)
        .filter(profile => profile.id !== FALLBACK_PROVIDER_ID)
        .map(profile => ({ id: profile.id, label: profile.label, settings: [...profile.settings], fixture: profile.fixture }));
}
