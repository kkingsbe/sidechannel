import { healthcareArtifactSchema, type HealthcareArtifact, type HealthcarePublic } from '@sidechannel/contracts/healthcare/contracts';
export function validateHealthcareArtifact(value: unknown, publicData: HealthcarePublic): HealthcareArtifact {
    const parsed = healthcareArtifactSchema.safeParse(value);
    if (!parsed.success) throw new Error('Invalid ranking artifact structure');
    const artifact = parsed.data, seen = new Set<string>();
    if (artifact.entries.length > publicData.top_k) throw new Error('Ranking exceeds top K');
    artifact.entries.forEach((entry, index) => {
        if (entry.rank !== index + 1) throw new Error('Ranking ranks must be contiguous');
        if (!publicData.case_keys.includes(entry.case_key) || seen.has(entry.case_key)) throw new Error('Ranking cases must be known and unique');
        seen.add(entry.case_key);
        if ([...entry.note].length > 200) throw new Error('Ranking notes exceed 200 Unicode code points');
        if (entry.uncertain && !entry.note.trim()) throw new Error('Uncertain entries require an explanation');
    });
    return artifact;
}
