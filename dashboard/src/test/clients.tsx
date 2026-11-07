import React, { type ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RequesterProvider } from '../lib/api';
import { ApiClientProvider, createClients, type ApiClients } from '../lib/clients/context';
import type { Requester } from '../lib/transport';

export interface FakeCall {
    path: string;
    options?: RequestInit;
    /** Parsed JSON body when the request carried one; tests assert exact payloads with it. */
    body?: any;
}

export interface FakeServer {
    request: Requester;
    calls: FakeCall[];
    respond(handler: (path: string, options?: RequestInit) => unknown): void;
}

/**
 * Route-table fake for the injected requester. The handler receives the API-relative path
 * the adapter sends (Jev routes are prefixed with `/jev`); every call is recorded with its
 * options and parsed body.
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

export type ClientOverrides = { [K in keyof ApiClients]?: Partial<ApiClients[K]> };

/** WS6-compatible fake client set: real client behaviour over a fake requester, with member overrides. */
export function fakeClients(overrides: ClientOverrides = {}, request?: Requester): ApiClients {
    const clients = createClients(request ? { request } : {});
    for (const [key, value] of Object.entries(overrides))
        if (value) Object.assign(clients[key as keyof ApiClients], value);
    return clients;
}

export const clientsFor = (server: FakeServer): ApiClients => fakeClients({}, server.request);

/**
 * Page-level test clients: the same client surface, but the fake requester answers directly in
 * dashboard view-model shapes. Adapter translation/mapping has dedicated tests
 * (`lib/adapters/jev.test.ts`), so page tests stay focused on rendering and requests.
 */
export const pageClients = (server: FakeServer, overrides: ClientOverrides = {}): ApiClients => {
    const clients = createClients({ request: server.request, adapt: false });
    for (const [key, value] of Object.entries(overrides))
        if (value) Object.assign(clients[key as keyof ApiClients], value);
    return clients;
};

let active: ApiClients | undefined;

/** Activates the clients used by the next `renderWithServer` call. */
export function activate(server: FakeServer, overrides: ClientOverrides = {}): ApiClients {
    active = pageClients(server, overrides);
    return active;
}

export function renderWithClients(node: ReactNode, options: { clients?: ApiClients; route?: string | string[] } = {}): RenderResult {
    const clients = options.clients ?? active ?? fakeClients();
    const entries = typeof options.route === 'string' ? [options.route] : options.route ?? ['/'];
    return render(
        <MemoryRouter initialEntries={entries}>
            <ApiClientProvider clients={clients}>{node}</ApiClientProvider>
        </MemoryRouter>,
    );
}

/** Renders under the clients activated by the current fake server; the node may own its router. */
export function renderWithServer(node: ReactNode): RenderResult {
    return render(<ApiClientProvider clients={active ?? fakeClients()}>{node}</ApiClientProvider>);
}

export const withServer = (server: FakeServer) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return <RequesterProvider value={server.request}>{children}</RequesterProvider>;
    };
