import React, { type ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { RequesterProvider } from '../lib/api';
import type { Requester } from '../lib/transport';

export interface FakeCall {
    path: string;
    options?: RequestInit;
    /** Parsed JSON body when the request carried one; tests assert exact payloads with it. */
    body?: unknown;
}

export interface FakeServer {
    request: Requester;
    calls: FakeCall[];
    respond(handler: (path: string, options?: RequestInit) => unknown): void;
}

/**
 * Route-table fake for the injected requester. The handler receives the API-relative path
 * (no `/api` prefix); every call is recorded with its options and parsed body.
 */
export function fakeServer(handler: (path: string, options?: RequestInit) => unknown = () => { throw new Error('Unexpected request'); }): FakeServer {
    const calls: FakeCall[] = [];
    let route = handler;
    return {
        calls,
        respond(next) { route = next; },
        request: (async <T,>(path: string, options?: RequestInit) => {
            calls.push({ path, options, ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}) });
            return structuredClone(await route(path, options)) as T;
        }) as Requester,
    };
}

export const withServer = (server: FakeServer) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return <RequesterProvider value={server.request}>{children}</RequesterProvider>;
    };

export const renderWithServer = (node: ReactNode, server: FakeServer): RenderResult =>
    render(<RequesterProvider value={server.request}>{node}</RequesterProvider>);
