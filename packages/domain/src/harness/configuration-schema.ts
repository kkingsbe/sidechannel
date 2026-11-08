import { buildConfigurationSchema } from '@sidechannel/contracts/server/config-schema';
import { GENERIC_SETTINGS } from '../providers/settings.js';

/**
 * The declarative form schema is the union of every selectable provider's controls, so
 * the editor can render a control for each setting a validated configuration may carry.
 */
export const configurationSchema = buildConfigurationSchema(GENERIC_SETTINGS);
