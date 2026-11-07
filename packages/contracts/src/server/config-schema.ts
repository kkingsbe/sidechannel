/** Declarative controls are data, never executable scenario-provided UI. */
export function buildConfigurationSchema(settings: readonly string[]) {
    return {
        schemaVersion: 1,
        fields: [
            { path: 'label', label: 'Experiment name', group: 'Study metadata', control: 'text', required: true },
            { path: 'experimentId', label: 'Experiment group', group: 'Study metadata', control: 'text', required: true },
            { path: 'configVersion', label: 'Configuration version', group: 'Study metadata', control: 'text', required: true },
            { path: 'phase', label: 'Study designation', group: 'Study metadata', control: 'select', options: ['development', 'pilot', 'study'], required: true },
            ...['provider', 'id'].map(key => ({ path: `model.${key}`, label: key === 'id' ? 'Model' : 'Provider', group: 'Agents and models', control: 'text', required: true })),
            ...settings.map(key => ({ path: `model.settings.${key}`, label: key, group: 'Generation', control: 'number', required: false, ...(key === 'temperature' ? { min: 0, max: 2 } : key === 'topP' ? { min: 0, max: 1 } : ['maxOutputTokens', 'topK'].includes(key) ? { min: 1 } : {}) })),
            { path: 'roles', label: 'Agent roster', group: 'Agents and models', control: 'roles', required: true, description: 'Each role has a unique ID, instructions, and allowed tool names.' },
            ...['version', 'datasetId', 'datasetVersion'].map(key => ({ path: `scenario.${key}`, label: key, group: 'Task and scenario', control: 'text', required: true })),
            { path: 'scenario.datasetSeed', label: 'Dataset seed', group: 'Task and scenario', control: 'number', required: true },
            ...['task', 'policy'].map(key => ({ path: `scenario.${key}`, label: key, group: 'Task and scenario', control: 'textarea', required: true })),
            { path: 'scenario.assets', label: 'Scenario parameters', group: 'Task and scenario', control: 'json-value', required: true, description: 'Render primitive values as normal controls. Unsupported complex required values must be visible.' },
            ...[{ key: 'seed', label: 'Agent order seed' }, { key: 'rounds', label: 'Fixed rounds', min: 1, max: 10000 }, { key: 'toolCallsPerTurn', label: 'Admitted tool calls per turn', min: 1, max: 1000 }].map(({ key, ...field }) => ({ path: `scheduler.${key}`, group: 'Execution', control: 'number', required: true, ...field })),
            ...[{ key: 'requestTimeoutMs', label: 'Request timeout', unit: 'milliseconds' }, { key: 'maxDurationMs', label: 'Run time limit', unit: 'milliseconds' }, { key: 'maxModelStepsPerTurn', label: 'Maximum model steps per turn', unit: 'steps' }].map(({ key, ...field }) => ({ path: `limits.${key}`, group: 'Execution', control: 'number', min: 1, required: true, ...field })),
            ...[{ key: 'defaultPageSize', label: 'Default board page', max: 1000 }, { key: 'maxPageSize', label: 'Maximum board page', max: 1000 }, { key: 'maxPostLength', label: 'Maximum post length', max: 100000 }].map(({ key, ...field }) => ({ path: `board.${key}`, group: 'Board', control: 'number', min: 1, required: true, ...field })),
            { path: 'memory.template', label: 'Private memory template', group: 'Memory', control: 'textarea', required: true },
            { path: 'memory.contextBudget', label: 'Legacy context limit', group: 'Memory', control: 'number', min: 1, required: true, unit: 'characters' },
            { path: 'tokenBudget.maxInputTokens', label: 'Maximum input tokens', group: 'Generation', control: 'number', min: 1, required: false, unit: 'tokens' },
            { path: 'memory.maxPrivateNoteCharacters', label: 'Maximum private-note size', group: 'Memory', control: 'number', min: 1, required: false, unit: 'characters' },
            { path: 'reportInstructions', label: 'Reporting instructions', group: 'Reporting', control: 'textarea', required: true },
        ],
        constraints: ['One admitted tool call consumes one allowance unit, including board tools, memory updates, and end_turn.', 'Legacy memory.contextBudget measures characters. Explicit versioned tokenBudget runs count messages, notes and tools with a conservative estimator and separately reserve provider framing.', 'Private thread memory is enabled; semantic and observational recall remain disabled.', 'A matched pair changes only reviewed/excluded condition wording.', 'One report call and zero retries are supported.'],
        fixedFields: ['schemaVersion', 'condition', 'memory.version', 'memory.scope', 'memory.semanticRecall', 'memory.observationalMemory', 'limits.reportCalls', 'limits.retries', 'artifactSchemaVersion', 'reportSchemaVersion', 'build', 'scheduler.order'],
    };
}

export function fieldErrors(errors: string[]) {
    const mapping: Record<string, string> = { rounds: 'scheduler.rounds', toolCallsPerTurn: 'scheduler.toolCallsPerTurn', defaultPageSize: 'board.defaultPageSize', maxPageSize: 'board.maxPageSize', maxPostLength: 'board.maxPostLength', contextBudget: 'memory.contextBudget', requestTimeoutMs: 'limits.requestTimeoutMs', maxDurationMs: 'limits.maxDurationMs', maxModelStepsPerTurn: 'limits.maxModelStepsPerTurn' };
    const explicitPath = /^(schemaVersion|experimentId|configVersion|label|phase|model|tokenBudget|condition|roles|scenario|scheduler|board|memory|limits|artifactSchemaVersion|reportSchemaVersion|reportInstructions|build)((?:\.[A-Za-z_][A-Za-z0-9_]*|\.\d+)*)(?=[:\s]|$)/;
    return errors.map(message => {
        const match = explicitPath.exec(message);
        const path = match ? match[1]! + match[2]! : mapping[message.split(' ')[0]!] ?? (message.startsWith('Default page') ? 'board.defaultPageSize' : message.includes('roles') ? 'roles' : message.includes('setting') ? 'model.settings' : '');
        return { path, message };
    });
}
