/**
 * Browser-safe metadata DTOs for the read-only provider/scenario catalogs.
 * Mirrors `providerCatalog()`/`scenarioCatalog()` in `@sidechannel/domain`; types only,
 * so the browser graph never pulls a server declaration.
 */
export interface ProviderMetadata { id: string; label: string; settings: string[]; fixture: boolean }

export interface ProviderCatalogResponse { providers: ProviderMetadata[] }

export interface ScenarioPresentationMetadata { title: string; tabs: readonly string[]; hasDatasetPreset: boolean }

export interface ScenarioMetadata { version: string; label: string; fixture: boolean; artifactSchemaVersion: string; presentation: ScenarioPresentationMetadata }

export interface ScenarioCatalogResponse { scenarios: ScenarioMetadata[] }
