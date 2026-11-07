import { useCallback, useEffect, useRef, useState } from 'react';
import { jevTransport } from './jev-transport';
export class ApiError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } }
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
 const adapted = await jevTransport<T>(path, options, rawApi);
 return adapted ? adapted.value : rawApi<T>(path, options);
}
export async function rawApi<T>(path: string, options?: RequestInit): Promise<T> {
 const response = await fetch('/api' + path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
 const data = await response.json().catch(() => null);
 if (!response.ok) throw new ApiError(response.status, data?.error || `Request failed (${response.status})`, data);
 return data as T;
}
export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export function useApi<T>(path: string | null, interval = 0) {
 const [data, setData] = useState<T>(); const [error, setError] = useState<Error>(); const [loading, setLoading] = useState(!!path); const [updatedAt, setUpdatedAt] = useState<number>(); const generation = useRef(0);
 const refresh = useCallback(async () => { if (!path) return; const current = ++generation.current; try { const value = await api<T>(path); if (current !== generation.current) return; setData(value); setError(undefined); setUpdatedAt(Date.now()); } catch (e) { if (current === generation.current) setError(e as Error); } finally { if (current === generation.current) setLoading(false); } }, [path]);
 useEffect(() => { setData(undefined); setError(undefined); setLoading(!!path); void refresh(); const timer = interval ? setInterval(() => { if (!document.hidden) void refresh(); }, interval) : undefined; return () => { generation.current++; clearInterval(timer); }; }, [refresh, interval, path]);
 return { data, error, loading, refresh, updatedAt };
}
export function useMutation() { const [busy, setBusy] = useState(false), [error, setError] = useState<Error>(), [message, setMessage] = useState(''); const run = async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => { setBusy(true); setError(undefined); setMessage(''); try { const result = await action(); if (success) setMessage(success); return result; } catch (e) { setError(e as Error); return undefined; } finally { setBusy(false); } }; return { busy, error, message, run, clear: () => { setError(undefined); setMessage(''); } }; }
export const arrayOf = <T,>(value: T[] | { items?: T[]; runs?: T[]; jobs?: T[]; evaluations?: T[] } | undefined): T[] => Array.isArray(value) ? value : value?.items ?? value?.runs ?? value?.jobs ?? value?.evaluations ?? [];
