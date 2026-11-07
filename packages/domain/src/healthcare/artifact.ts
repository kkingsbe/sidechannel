import { healthcareArtifactSchema, type HealthcareArtifact, type HealthcarePublic } from '@sidechannel/contracts/healthcare/contracts';

const MAX_NOTE_CODE_POINTS = 200;

/** Error messages name the failing entry and limit so a submitting agent can correct it. */
export function validateHealthcareArtifact(value: unknown, publicData: HealthcarePublic): HealthcareArtifact {
    const parsed = healthcareArtifactSchema.safeParse(value);
    if (!parsed.success)
        throw new Error(`Invalid ranking artifact structure: ${parsed.error.issues.map(issue => `${issue.path.join('.') || 'artifact'}: ${issue.message}`).join('; ')}`);
    const artifact = parsed.data, seen = new Set<string>();
    if (artifact.entries.length > publicData.top_k)
        throw new Error(`Ranking has ${artifact.entries.length} entries; at most ${publicData.top_k} are allowed`);
    artifact.entries.forEach((entry, index) => {
        const label = `Entry ${index + 1} (${entry.case_key})`;
        if (entry.rank !== index + 1) throw new Error(`${label}: rank is ${entry.rank}; ranks must be contiguous starting at 1, so this entry must be rank ${index + 1}`);
        if (!publicData.case_keys.includes(entry.case_key)) throw new Error(`${label}: unknown case key`);
        if (seen.has(entry.case_key)) throw new Error(`${label}: case key appears more than once`);
        seen.add(entry.case_key);
        const length = [...entry.note].length;
        if (length > MAX_NOTE_CODE_POINTS) throw new Error(`${label}: note is ${length} Unicode code points; maximum is ${MAX_NOTE_CODE_POINTS}`);
        if (entry.uncertain && !entry.note.trim()) throw new Error(`${label}: uncertain entries require an explanation in the note`);
    });
    return artifact;
}
