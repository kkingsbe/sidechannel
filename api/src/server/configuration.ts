import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { validateConfiguration } from '@sidechannel/domain/harness/config';
import { fieldErrors } from '@sidechannel/contracts/server/config-schema';
import type { HealthcareService } from '../healthcare/service.js';
import { validateAdaptionModelSelection } from './adaption-models.js';

export interface ConfigurationPipelineOptions {
    buildMetadata?: ExperimentConfig['build'];
    healthcare?: HealthcareService;
}

/** Build-metadata stamping, healthcare dataset resolution, schema validation and adaption-model admission. */
export function createConfigurationPipeline({ buildMetadata, healthcare }: ConfigurationPipelineOptions) {
    const withBuild = (input: unknown): unknown => input && typeof input === 'object' && !Array.isArray(input) ? { ...input, ...(buildMetadata ? { build: buildMetadata } : {}) } : input;
    function validate(input: unknown) {
        const validation = validateConfiguration(input), fieldIssues = fieldErrors(validation.errors);
        return { ...validation, fieldErrors: Object.fromEntries(fieldIssues.filter(issue => issue.path).map(issue => [issue.path, issue.message])), fieldIssues };
    }
    async function prepare(input: unknown) {
        let config = withBuild(input);
        try {
            if (healthcare) config = await healthcare.resolveConfiguration(config);
            else if ((config as ExperimentConfig)?.scenario?.version === 'healthcare-points-v0.3') throw new Error('scenario.datasetId: Healthcare catalog is unavailable; bootstrap the datasets');
        } catch (error) { const message = error instanceof Error ? error.message : 'Dataset resolution failed'; return { config, validation: { valid: false, errors: [message], fieldErrors: { 'scenario.datasetId': message }, fieldIssues: [{ path: 'scenario.datasetId', message }] } }; }
        const base = validate(config);
        const additional = base.valid ? await validateAdaptionModelSelection(config as ExperimentConfig) : [];
        if (!additional.length) return { config, validation: base };
        const issues = additional.map(message => ({ path: message.includes(':') ? message.split(':')[0]! : message.startsWith('model.') ? message.split(' ')[0]! : 'model.id', message }));
        return { config, validation: { ...base, valid: false, errors: [...base.errors, ...additional], fieldIssues: [...base.fieldIssues, ...issues], fieldErrors: { ...base.fieldErrors, ...Object.fromEntries(issues.map(issue => [issue.path, issue.message])) } } };
    }
    return { prepare, validate };
}

export type ConfigurationPipeline = ReturnType<typeof createConfigurationPipeline>;
