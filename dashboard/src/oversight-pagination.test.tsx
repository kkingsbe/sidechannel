// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { activate, fakeServer, renderWithServer } from './test/clients';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Oversight from './pages/Oversight';

const outcome = { id: 'outcome', name: 'Outcome', definition: 'A frozen definition', qualifyingCriteria: 'Executed conduct', presentGuidance: 'Cited evidence', absentGuidance: 'Supported absence', uncertainGuidance: 'Insufficient evidence', examples: '', exclusions: '', archived: false };
const definition = (revision: number) => ({ id: `definition:${revision}`, schemaVersion: 1, revision, createdAt: '2026-11-07T12:00:00Z', questions: 'Frozen question', outcomes: [outcome] });
const config = {label: 'Fixture', condition: {id: 'reviewed'}, model: {provider: 'scripted', id: 'fixture'}, scenario: {version: 'fixture-v1'}};
const runs = Array.from({ length: 125 }, (_, index) => ({ id: `run-${index + 1}`, config: { ...config, label: `Source ${index + 1}` }, status: 'completed' }));
const reviews = Array.from({ length: 125 }, (_, index) => ({ id: `review-${String(index + 1).padStart(3, '0')}`, runId: 'run-125', outcomeId: 'outcome', definitionRevisionId: 'definition:1', reviewer: 'Alice', reviewerKey: 'alice', revision: index + 1, sequence: index + 1, rationale: `Historical rationale ${index + 1}`, decision: 'uncertain', eventIds: [], outcomeDefinition: outcome, createdAt: '2026-11-07T12:00:00Z' }));
function page<T extends {id: string}>(rows: T[], url: URL) { const after = url.searchParams.get('after') || ''; const start = after ? rows.findIndex(row => row.id === after) + 1 : 0; const size = Number(url.searchParams.get('limit') || 25); const items = rows.slice(start, start + size); return {items, nextCursor: start + size < rows.length ? items.at(-1)!.id : null}; }
function mock(extra: (url: URL, options?: RequestInit) => unknown = () => undefined) {
  activate(fakeServer(async (path, options) => {
    const url = new URL(path, 'http://localhost');
    const custom = await extra(url, options); if (custom !== undefined) return custom;
    if (url.pathname === '/monitor-definitions') return definition(2);
    if (url.pathname === '/monitor-definitions/history') return page([definition(1), definition(2)], url);
    if (url.pathname === '/monitor-evaluations') return {items: [], nextCursor: null};
    if (url.pathname === '/runs') { const offset = Number(url.searchParams.get('offset') || 0), size = Number(url.searchParams.get('limit') || 25); return {items: runs.slice(offset, offset + size), total: runs.length, nextOffset: offset + size < runs.length ? offset + size : null}; }
    if (url.pathname.endsWith('/reviews/context')) return {runId: 'run-125', definition: definition(Number(url.searchParams.get('definitionRevisionId')?.split(':')[1] || 2)), evidenceRevision: 'source-hash', eventCount: 1, sequenceBoundary: 1};
    if (url.pathname.endsWith('/outcomes')) return [];
    if (url.pathname.endsWith('/reviews/latest')) return reviews.at(-1);
    if (url.pathname.endsWith('/reviews')) return page(reviews, url);
    throw new Error('Unexpected route ' + url);
  }));
}
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

it('pages beyond one hundred source runs while retaining selections across source pages', async () => {
  mock(); renderWithServer(<MemoryRouter initialEntries={['/?view=setup']}><Oversight /></MemoryRouter>); const user = userEvent.setup();
  await user.click(await screen.findByLabelText(/Source 1 ·/));
  const sources = screen.getByText('Completed source runs').parentElement!;
  for (let pageNumber = 1; pageNumber <= 4; pageNumber++) { await user.click(within(sources).getByRole('button', {name: 'Next'})); await screen.findByLabelText(new RegExp(`Source ${pageNumber * 25 + 1} ·`)); }
  await user.click(screen.getByLabelText(/Source 125 ·/));
  expect(screen.getByText('2 completed runs')).toBeTruthy();
  expect(screen.getByRole('button', {name: 'Remove source run-1'})).toBeTruthy();
  expect(screen.getByRole('button', {name: 'Remove source run-125'})).toBeTruthy();
});

it('uses an exact latest reviewer query beyond visible history and keeps historical definition context and exports', async () => {
  let submitted: any; let releaseBob: ((value: unknown) => void) | undefined;
  mock((url, options) => {
    if (url.pathname.endsWith('/reviews/latest') && url.searchParams.get('reviewer') === 'bob') return new Promise(resolve => {releaseBob = resolve;});
    if (url.pathname.endsWith('/reviews') && options?.method === 'POST') {submitted = JSON.parse(String(options.body)); return {...reviews.at(-1), id: 'review-126'};}
  });
  renderWithServer(<MemoryRouter initialEntries={['/?view=references&run=run-125&definition=definition:1']}><Oversight /></MemoryRouter>);
  const user = userEvent.setup(); const identity = await screen.findByLabelText('Claimed reviewer identity');
  expect((screen.getByRole('combobox', {name: 'Reference definition revision'}) as HTMLSelectElement).value).toBe('definition:1');
  expect(screen.getByRole('link', {name: 'Reference export'}).getAttribute('href')).toContain('definitionRevisionId=definition%3A1');
  fireEvent.change(identity, {target: {value: 'ＡＬＩＣＥ'}});
  await user.type(screen.getByLabelText('Rationale / unresolved questions'), 'Revision beyond the first history page');
  const append = await screen.findByRole('button', {name: 'Append revision / reconfirm'});
  await user.click(append);
  await waitFor(() => expect(submitted?.supersedesId).toBe('review-125'));
  expect(submitted.definitionRevisionId).toBe('definition:1');
  const historyNext = screen.getAllByRole('button', {name: 'Next'}).at(-1)!;
  await user.click(historyNext); await screen.findByText('Historical rationale 26');
  expect(screen.queryByText('Historical rationale 1')).toBeNull();
  await user.type(screen.getByLabelText('Rationale / unresolved questions'), 'New reviewer judgment');
  fireEvent.change(identity, {target: {value: 'Bob'}});
  await waitFor(() => expect(releaseBob).toBeTypeOf('function'));
  expect((screen.getByRole('button', {name: 'Save provisional reference'}) as HTMLButtonElement).disabled).toBe(true);
  releaseBob!(null);
  await waitFor(() => expect((screen.getByRole('button', {name: 'Save provisional reference'}) as HTMLButtonElement).disabled).toBe(false));
});

it('pages definition history and evaluation jobs rather than silently limiting the dataset', async () => {
  const definitions = Array.from({length: 125}, (_, index) => definition(index + 1));
  const jobs = Array.from({length: 55}, (_, index) => ({id: `job-${String(index + 1).padStart(3, '0')}`, settings: {model: {provider: 'fixture', id: `Monitor ${index + 1}`}}, runIds: ['run-1'], definition: definition(1), status: 'completed', createdAt: '2026-11-07T12:00:00Z'}));
  mock(url => url.pathname === '/monitor-definitions/history' ? page(definitions, url) : url.pathname === '/monitor-evaluations' ? page(jobs, url) : undefined);
  renderWithServer(<MemoryRouter initialEntries={['/?view=jobs']}><Oversight /></MemoryRouter>); const user = userEvent.setup();
  await screen.findByText('fixture/Monitor 1');
  await user.click(screen.getByRole('button', {name: 'Next'})); await screen.findByText('fixture/Monitor 26');
  await user.click(screen.getByRole('button', {name: 'Next'})); await screen.findByText('fixture/Monitor 55');
  await user.click(screen.getByRole('tab', {name: 'Configure & preview'}));
  const revision = await screen.findByRole('combobox', {name: 'Definition revision'}); const revisionField = revision.parentElement!;
  for(let index = 1; index <= 4; index++) { await user.click(within(revisionField).getByRole('button', {name: 'Next'})); await screen.findByRole('option', {name: new RegExp(`Revision ${index * 25 + 1} `)}); }
  expect(screen.getByRole('option', {name: /Revision 125 /})).toBeTruthy();
});

