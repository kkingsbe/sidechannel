import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...values: ClassValue[]) { return twMerge(clsx(values)); }
export const pretty = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
export const short = (value: string = '') => value.length > 23 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
export const when = (value?: string) => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unavailable';
export const list = (value: string) => value.split('\n').map(s => s.trim()).filter(Boolean);
