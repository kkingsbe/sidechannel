import type { PlaybookCatalogItem, ValidatedPlaybook } from './contracts.js';

/** Immutable registry of uploaded playbooks, keyed by playbook id and version. */
export interface PlaybookCatalog {
    /** Idempotent for identical bytes; throws when the same id/version is registered with different content. */
    register(value: ValidatedPlaybook): Promise<PlaybookCatalogItem>;
    list(): Promise<PlaybookCatalogItem[]>;
    get(playbookId: string, playbookVersion: string): Promise<ValidatedPlaybook | null>;
}
