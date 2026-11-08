import { isDeepStrictEqual } from 'node:util';
import type { MongoClient, Db } from 'mongodb';
import type { DatasetCatalogItem, EvaluatorReference, HealthcareEvaluation, HealthcareManifest, HealthcareTruth, ValidatedHealthcarePackage } from '@sidechannel/contracts/healthcare/contracts';
import type { HealthcareCatalog, RuntimeDataset } from '@sidechannel/contracts/healthcare/repository';
import { parseStrictJson, sha256, validateHealthcareAssets, validateHealthcarePackage } from '@sidechannel/domain/healthcare/package';

const identity = (id: string, version: string) => `${id}:${version}`;
const catalogItem = (p: ValidatedHealthcarePackage): DatasetCatalogItem => ({ displayName: p.manifest.dataset_id === 'fixture10-s101-points' ? 'Healthcare fixture · 10 cases' : p.manifest.dataset_id, datasetId: p.manifest.dataset_id, datasetVersion: p.manifest.dataset_version, scenarioVersion: p.manifest.scenario_version, panelSize: p.assets.public.panel_size, topK: p.assets.public.top_k, validationStatus: 'valid', runtimeSupported: true, packageHash: p.packageHash, assetsHash: p.assetsHash });
const conflict = (): never => { throw new Error('Immutable dataset identity conflicts with different package bytes'); };
interface StoredRuntime { key: string; item: DatasetCatalogItem; manifest: HealthcareManifest; assets: RuntimeDataset['assets']; truthHash: string; manifestBytes: string; assetsBytes: string; }
interface StoredTruth { key: string; packageHash: string; truthHash: string; truth: HealthcareTruth; truthBytes: string; }
const checked = (p: ValidatedHealthcarePackage) => validateHealthcarePackage(p.manifestBytes, p.assetsBytes, p.truthBytes);

/** In-memory port for deterministic tests and explicit demo fixtures. */
export class InMemoryHealthcareCatalog implements HealthcareCatalog {
    private packages = new Map<string, ValidatedHealthcarePackage>();
    private references = new Map<string, EvaluatorReference>();
    private evaluations = new Map<string, HealthcareEvaluation>();
    async register(input: ValidatedHealthcarePackage) { const p = checked(input), key = identity(p.manifest.dataset_id, p.manifest.dataset_version), old = this.packages.get(key); if (old && (old.packageHash !== p.packageHash || old.assetsHash !== p.assetsHash || old.truthHash !== p.truthHash)) conflict(); this.packages.set(key, structuredClone(p)); return catalogItem(p); }
    async list() { return [...this.packages.values()].map(catalogItem).sort((a, b) => a.datasetId.localeCompare(b.datasetId)); }
    async runtime(id: string, version: string) { const p = this.packages.get(identity(id, version)); return p ? structuredClone({ item: catalogItem(p), manifest: p.manifest, assets: p.assets, truthHash: p.truthHash }) : null; }
    async provenance(id: string, version: string) { return structuredClone(this.packages.get(identity(id, version))?.manifest ?? null); }
    async freezeReference(reference: EvaluatorReference) { const old = this.references.get(reference.runId); if (old && !isDeepStrictEqual(old, reference)) throw new Error('Frozen evaluator reference conflict'); this.references.set(reference.runId, structuredClone(reference)); }
    async getReference(runId: string) { return structuredClone(this.references.get(runId) ?? null); }
    async evaluatorTruth(reference: EvaluatorReference) { const p = this.packages.get(identity(reference.datasetId, reference.datasetVersion)); if (!p || p.packageHash !== reference.packageHash || p.truthHash !== reference.truthHash || p.assetsHash !== reference.assetsHash) throw new Error('Evaluator package integrity mismatch'); return structuredClone(p.truth); }
    async saveEvaluation(value: HealthcareEvaluation) { const key = `${value.runId}:${value.artifactVersion}:${value.evaluatorVersion}`, old = this.evaluations.get(key); if (old) return structuredClone(old); this.evaluations.set(key, structuredClone(value)); return structuredClone(value); }
    async getEvaluation(runId: string, artifactVersion: number, evaluatorVersion: string) { return structuredClone(this.evaluations.get(`${runId}:${artifactVersion}:${evaluatorVersion}`) ?? null); }
    async deleteRunRecords(runId: string) {
        const references = this.references.delete(runId) ? 1 : 0;
        const owned = [...this.evaluations.entries()].filter(([, evaluation]) => evaluation.runId === runId);
        for (const [key] of owned) this.evaluations.delete(key);
        return { references, evaluations: owned.length };
    }
}

/** Runtime content and researcher truth have separate collection/access paths. */
export class MongoHealthcareCatalog implements HealthcareCatalog {
    constructor(private readonly client: MongoClient, private readonly db: Db) { }
    async initialize() { await Promise.all([this.db.collection('healthcare_datasets').createIndex({ key: 1 }, { unique: true }), this.db.collection('healthcare_evaluator_truth').createIndex({ key: 1 }, { unique: true }), this.db.collection('healthcare_evaluator_references').createIndex({ runId: 1 }, { unique: true }), this.db.collection('healthcare_evaluations').createIndex({ runId: 1, artifactVersion: 1, evaluatorVersion: 1 }, { unique: true })]); }
    async register(input: ValidatedHealthcarePackage) {
        const p = checked(input), key = identity(p.manifest.dataset_id, p.manifest.dataset_version), item = catalogItem(p), session = this.client.startSession();
        try {
            await session.withTransaction(async () => {
                const existing = await this.db.collection<StoredRuntime>('healthcare_datasets').findOne({ key }, { session });
                const existingTruth = await this.db.collection<StoredTruth>('healthcare_evaluator_truth').findOne({ key }, { session });
                if (existing || existingTruth) { if (!existing || !existingTruth || existing.item.packageHash !== p.packageHash || existing.item.assetsHash !== p.assetsHash || existing.truthHash !== p.truthHash || existingTruth.packageHash !== p.packageHash || existingTruth.truthHash !== p.truthHash || existing.manifestBytes !== p.manifestBytes || existing.assetsBytes !== p.assetsBytes || existingTruth.truthBytes !== p.truthBytes) conflict(); return; }
                await this.db.collection<StoredTruth>('healthcare_evaluator_truth').insertOne({ key, packageHash: p.packageHash, truthHash: p.truthHash, truth: p.truth, truthBytes: p.truthBytes }, { session });
                await this.db.collection<StoredRuntime>('healthcare_datasets').insertOne({ key, item, manifest: p.manifest, assets: p.assets, truthHash: p.truthHash, manifestBytes: p.manifestBytes, assetsBytes: p.assetsBytes }, { session });
            });
        } finally { await session.endSession(); }
        return item;
    }
    async list() { const rows = await this.db.collection<StoredRuntime>('healthcare_datasets').find().sort({ 'item.datasetId': 1 }).toArray(); const result: DatasetCatalogItem[] = []; for (const row of rows) if (await this.runtime(row.item.datasetId, row.item.datasetVersion)) result.push(row.item); return result; }
    async runtime(id: string, version: string): Promise<RuntimeDataset | null> {
        const key = identity(id, version), row = await this.db.collection<StoredRuntime>('healthcare_datasets').findOne({ key }); if (!row) return null;
        // Partial writes are never launchable, even if an operator manually damaged registration.
        const truth = await this.db.collection<StoredTruth>('healthcare_evaluator_truth').findOne({ key }, { projection: { packageHash: 1, truthHash: 1 } });
        if (!truth || truth.packageHash !== row.item.packageHash || truth.truthHash !== row.truthHash) return null;
        try {
            if (sha256(row.manifestBytes) !== row.item.packageHash || sha256(row.assetsBytes) !== row.item.assetsHash || !isDeepStrictEqual(parseStrictJson(row.manifestBytes), row.manifest)) return null;
            const assets = validateHealthcareAssets(parseStrictJson(row.assetsBytes)); if (!isDeepStrictEqual(assets, row.assets)) return null;
            return { item: row.item, manifest: row.manifest, assets, truthHash: row.truthHash };
        } catch { return null; }
    }
    async provenance(id: string, version: string) { return (await this.runtime(id, version))?.manifest ?? null; }
    async freezeReference(reference: EvaluatorReference) {
        const old = await this.getReference(reference.runId); if (old) { if (!isDeepStrictEqual(old, reference)) throw new Error('Frozen evaluator reference conflict'); return; }
        try { await this.db.collection<EvaluatorReference>('healthcare_evaluator_references').insertOne(reference); } catch (error) { const found = await this.getReference(reference.runId); if (!found || !isDeepStrictEqual(found, reference)) throw error; }
    }
    async getReference(runId: string): Promise<EvaluatorReference | null> { const row = await this.db.collection<EvaluatorReference>('healthcare_evaluator_references').findOne({ runId }, { projection: { _id: 0 } }); return row; }
    async evaluatorTruth(reference: EvaluatorReference): Promise<HealthcareTruth> {
        const runtime = await this.runtime(reference.datasetId, reference.datasetVersion); if (!runtime || runtime.item.packageHash !== reference.packageHash || runtime.item.assetsHash !== reference.assetsHash || runtime.truthHash !== reference.truthHash) throw new Error('Evaluator package integrity mismatch');
        const row = await this.db.collection<StoredTruth>('healthcare_evaluator_truth').findOne({ key: identity(reference.datasetId, reference.datasetVersion), packageHash: reference.packageHash, truthHash: reference.truthHash }); if (!row) throw new Error('Evaluator truth unavailable');
        if (sha256(row.truthBytes) !== reference.truthHash || !isDeepStrictEqual(parseStrictJson(row.truthBytes), row.truth)) throw new Error('Evaluator truth integrity mismatch');
        return row.truth;
    }
    async saveEvaluation(value: HealthcareEvaluation): Promise<HealthcareEvaluation> { const key = { runId: value.runId, artifactVersion: value.artifactVersion, evaluatorVersion: value.evaluatorVersion }; await this.db.collection<HealthcareEvaluation>('healthcare_evaluations').updateOne(key, { $setOnInsert: value }, { upsert: true }); return (await this.getEvaluation(value.runId, value.artifactVersion, value.evaluatorVersion))!; }
    async getEvaluation(runId: string, artifactVersion: number, evaluatorVersion: string): Promise<HealthcareEvaluation | null> { return this.db.collection<HealthcareEvaluation>('healthcare_evaluations').findOne({ runId, artifactVersion, evaluatorVersion }, { projection: { _id: 0 } }); }
    async deleteRunRecords(runId: string) {
        const [references, evaluations] = await Promise.all([this.db.collection('healthcare_evaluator_references').deleteMany({ runId }), this.db.collection('healthcare_evaluations').deleteMany({ runId })]);
        return { references: references.deletedCount, evaluations: evaluations.deletedCount };
    }
}
