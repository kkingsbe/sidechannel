/** Domain failure carrying the HTTP status the API used to infer. T3c.5 replaces this with DomainFailure. */
export class OversightError extends Error { constructor(public status: number, message: string) { super(message); } }
