import type { Db } from 'mongodb';
import type { Playbook, PlaybookCatalogItem, ValidatedPlaybook } from '@sidechannel/contracts/playbook/contracts';
import type { PlaybookCatalog } from '@sidechannel/contracts/playbook/repository';
import { playbookCatalogItem, validatePlaybook } from '@sidechannel/domain/playbook/package';

const identity = (id: string, version: string) => `${id}:${version}`;
const conflict = (): never => { throw new Error('Immutable playbook identity conflicts with different content'); };
const order = (a: PlaybookCatalogItem, b: PlaybookCatalogItem) => a.displayName.localeCompare(b.displayName) || a.playbookId.localeCompare(b.playbookId) || a.playbookVersion.localeCompare(b.playbookVersion);
interface StoredPlaybook { key: string; item: PlaybookCatalogItem; playbook: Playbook; playbookBytes: string; playbookHash: string; }
/** Callers' hash and bytes are never trusted; the catalog derives both from the playbook itself. */
const checked = (value: ValidatedPlaybook) => validatePlaybook(value.playbook);
/** Returns the stored content only when its bytes still hash to the recorded identity. */
const intact = (row: StoredPlaybook): ValidatedPlaybook | null => {
    try { const v = validatePlaybook(row.playbook); return v.playbookHash === row.playbookHash && v.playbookBytes === row.playbookBytes && row.item.playbookHash === v.playbookHash ? v : null; } catch { return null; }
};

/** In-memory port for deterministic tests. */
export class InMemoryPlaybookCatalog implements PlaybookCatalog {
    private rows = new Map<string, StoredPlaybook>();
    async register(value: ValidatedPlaybook) {
        const v = checked(value), key = identity(v.playbook.playbook_id, v.playbook.playbook_version), old = this.rows.get(key);
        if (old) { if (old.playbookHash !== v.playbookHash) conflict(); return structuredClone(old.item); }
        const item = playbookCatalogItem(v, new Date().toISOString()); this.rows.set(key, structuredClone({ key, item, playbook: v.playbook, playbookBytes: v.playbookBytes, playbookHash: v.playbookHash })); return structuredClone(item);
    }
    async list() { return [...this.rows.values()].map(row => structuredClone(row.item)).sort(order); }
    async get(playbookId: string, playbookVersion: string) { const row = this.rows.get(identity(playbookId, playbookVersion)), v = row && intact(row); return v ? structuredClone(v) : null; }
}

export class MongoPlaybookCatalog implements PlaybookCatalog {
    constructor(private readonly db: Db) { }
    private get collection() { return this.db.collection<StoredPlaybook>('playbooks'); }
    async initialize() { await this.collection.createIndex({ key: 1 }, { unique: true }); }
    async register(value: ValidatedPlaybook) {
        const v = checked(value), key = identity(v.playbook.playbook_id, v.playbook.playbook_version);
        const existing = async () => { const row = await this.collection.findOne({ key }, { projection: { _id: 0 } }); if (!row) return null; if (row.playbookHash !== v.playbookHash) conflict(); return row.item; };
        const old = await existing(); if (old) return old;
        const item = playbookCatalogItem(v, new Date().toISOString());
        try { await this.collection.insertOne({ key, item, playbook: v.playbook, playbookBytes: v.playbookBytes, playbookHash: v.playbookHash }); } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 11000)) throw error;
            const raced = await existing(); if (!raced) throw error; return raced;
        }
        return item;
    }
    async list() { const rows = await this.collection.find({}, { projection: { _id: 0, item: 1 } }).toArray(); return rows.map(row => row.item).sort(order); }
    async get(playbookId: string, playbookVersion: string) { const row = await this.collection.findOne({ key: identity(playbookId, playbookVersion) }, { projection: { _id: 0 } }); return row ? intact(row) : null; }
}
