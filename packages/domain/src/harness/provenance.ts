import { readFile } from 'node:fs/promises';
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';

/** Build-time source fingerprint; containers do not need source or development dependencies. */
export async function buildMetadata(): Promise<ExperimentConfig['build']> {
    const candidates = [new URL('../build-provenance.json', import.meta.url), new URL('../../dist/build-provenance.json', import.meta.url)];
    for (const file of candidates) {
        let content: string;
        try { content = await readFile(file, 'utf8'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw error;
        }
        const metadata = JSON.parse(content) as ExperimentConfig['build'];
        if (!metadata.revision?.startsWith('source-sha256:') || !metadata.packages) throw new Error('Invalid build provenance artifact');
        return { revision: metadata.revision, packages: { ...metadata.packages, node: process.version } };
    }
    throw new Error('Build provenance is missing. Run npm run build from the repository root.');
}
