export class ScenarioValidationError extends Error {
    constructor(message: string, readonly disposition: 'invalid' | 'denied' = 'invalid') { super(message); }
}
