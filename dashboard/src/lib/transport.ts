/** The dashboard's single network boundary. Paths are API-relative (`/runs/x`, never `/api/runs/x`). */
export class ApiError extends Error {
    constructor(public status: number, message: string, public details?: unknown) {
        super(message);
        this.name = 'ApiError';
    }
}

export type Requester = <T>(path: string, options?: RequestInit) => Promise<T>;

export const request: Requester = async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const response = await fetch('/api' + path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, (data as { error?: string } | null)?.error || `Request failed (${response.status})`, data);
    return data as T;
};

/** Builds `path?limit=..&after=..` query strings without dropping existing parameters. */
export function withQuery(path: string, parameters: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters))
        if (value !== undefined && value !== '') search.set(key, String(value));
    const query = search.toString();
    return query ? path + (path.includes('?') ? '&' : '?') + query : path;
}
