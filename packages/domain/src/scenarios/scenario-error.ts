export class ScenarioValidationError extends Error {
    /** `details` is returned to the acting agent so it can correct the call. */
    constructor(message: string, readonly disposition: 'invalid' | 'denied' = 'invalid', readonly details?: string) { super(message); }
}
