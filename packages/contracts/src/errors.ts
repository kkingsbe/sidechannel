/** Transport-neutral failure vocabulary. Producers throw these; each transport decides status codes. */
export type FailureKind = 'invalid' | 'not-found' | 'conflict' | 'too-large' | 'unavailable';

export class DomainFailure extends Error {
    constructor(public kind: FailureKind, message: string) {
        super(message);
        this.name = 'DomainFailure';
    }
}
