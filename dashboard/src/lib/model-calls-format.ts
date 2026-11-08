/**
 * Display formatting helpers for the model-call fold. Split out of `model-calls.ts`;
 * public names are re-exported there.
 */
import { isRecord } from './model-calls-types';

/** Format a number with thousands separators (en-US, stable across locales). */
export function formatTokens(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : String(n);
}

export function safeJson(value: unknown, space?: number): string {
  try { return JSON.stringify(value, null, space) ?? ''; } catch { return String(value); }
}

/** Tool arguments for display: string values that hold JSON are parsed so nested payloads pretty-print. */
export function prettyArguments(value: unknown): string {
  const expand = (v: unknown, depth: number): unknown => {
    if (depth > 4) return v;
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try { return expand(JSON.parse(t), depth + 1); } catch { return v; }
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(x => expand(x, depth + 1));
    if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x, depth + 1)]));
    return v;
  };
  return safeJson(expand(value, 0), 2) || '{}';
}
