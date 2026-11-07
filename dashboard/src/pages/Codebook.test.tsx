// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CodebookPage from './Codebook';

const definition = { id:'supply', code:'SUPPLY', name:'Supply', definition:'Original definition', inclusionCriteria:[], exclusionCriteria:[], examples:[], counterexamples:[], qualifyingEvidenceTypes:[], enabled:true, archived:false, color:'#123456' };
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('preserves conflicting local edits for explicit reconciliation against the latest revision', async () => {
  let revision = 1;
  const submissions: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path:string, options?:RequestInit) => {
    const rev = (number:number) => ({id:'revision-'+number, codebookId:'book', revision:number, createdAt:'2026-11-07T12:00:00Z', createdBy:'Researcher', definitions:number===1?[definition]:[{...definition,definition:'Teammate definition'},{...definition,id:'new',code:'NEW',name:'Added by teammate'}]});
    let value:unknown, status=200;
    if (path.startsWith('/api/jev/codebooks?')) value={items:[{id:'book',name:'Study',currentRevisionId:'revision-'+revision}],nextCursor:null};
    else if (path==='/api/jev/codebooks/book' && options?.method==='PATCH') {
      const submitted=JSON.parse(String(options.body)); submissions.push(submitted);
      if (revision===1) {revision=2;status=409;value={error:'Codebook revision conflict'};}
      else value={codebook:{id:'book',name:submitted.name,currentRevisionId:'revision-3'},revision:{...rev(3),definitions:submitted.definitions}};
    } else if(path==='/api/jev/codebooks/book') value={id:'book',name:'Study',currentRevisionId:'revision-'+revision};
    else if(path.startsWith('/api/jev/codebooks/book/revisions/')) value=rev(Number(path.split('-').at(-1)));
    else throw new Error('Unexpected request '+path);
    return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  }));
  render(<CodebookPage/>); const user=userEvent.setup();
  const field=await screen.findByLabelText('Definition'); await user.clear(field); await user.type(field,'My preserved changes');
  await user.type(screen.getByLabelText('Revision author'),'Reviewer'); await user.click(screen.getByRole('button',{name:'Save revision'}));
  await user.click(await screen.findByRole('button',{name:'Load latest for reconciliation'}));
  await screen.findByRole('heading',{name:'Recover edits from an older revision'});
  expect((screen.getByLabelText('Definition') as HTMLTextAreaElement).value).toBe('Teammate definition');
  await user.click(screen.getByRole('button',{name:'Restore local edits for reconciliation'}));
  expect((screen.getByLabelText('Definition') as HTMLTextAreaElement).value).toBe('My preserved changes');
  await user.click(screen.getByRole('button',{name:'Save revision'}));
  await screen.findByText('New immutable codebook revision saved. Existing analyses keep their frozen definitions.');
  expect(submissions.map(value=>value.expectedRevisionId)).toEqual(['revision-1','revision-2']);
  expect(submissions[1].definitions.map((value:any)=>value.id)).toEqual(['supply','new']);
});

function archiveServer(initial: Record<string, any>) {
  const books: Record<string, any> = structuredClone(initial);
  const calls: { path: string; method: string; body?: any }[] = [];
  const rev = (id: string) => ({ id: 'rev-' + id, codebookId: id, revision: 1, createdAt: '2026-11-07T12:00:00Z', createdBy: 'Researcher', definitions: [definition] });
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ path, method, body });
    let value: unknown, status = 200;
    const archiveAction = path.match(/^\/api\/jev\/codebooks\/([^/?]+)\/(archive|restore)$/);
    if (path.startsWith('/api/jev/codebooks?')) {
      const filter = new URL(path, 'http://x').searchParams.get('archived') ?? 'exclude';
      value = { items: Object.values(books).filter(b => filter === 'include' || !b.archivedAt), nextCursor: null };
    } else if (archiveAction) {
      const book = books[archiveAction[1]];
      if (body.expectedRevisionId !== book.currentRevisionId) { status = 409; value = { error: 'Codebook revision conflict' }; }
      else {
        if (archiveAction[2] === 'archive') { book.archivedAt = '2026-11-09T10:00:00Z'; book.archivedBy = body.actor; }
        else { delete book.archivedAt; delete book.archivedBy; }
        value = { codebook: book };
      }
    } else if (/^\/api\/jev\/codebooks\/[^/]+\/revisions\//.test(path)) value = rev(path.split('/')[4]);
    else if (/^\/api\/jev\/codebooks\/[^/]+$/.test(path)) value = books[path.split('/').at(-1)!];
    else throw new Error('Unexpected request ' + path);
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  }));
  return { calls, books };
}
const bookRecord = (id: string, extra = {}) => ({ id, name: 'Book ' + id, currentRevisionId: 'rev-' + id, createdAt: '2026-11-07T12:00:00Z', updatedAt: '2026-11-07T12:00:00Z', ...extra });
const enabledButton = async (name: RegExp) => { let button!: HTMLButtonElement; await waitFor(() => { button = screen.getByRole('button', { name }) as HTMLButtonElement; expect(button.disabled).toBe(false); }); return button; };
it('archives after confirmation, sends the revision and actor, and selects the next active codebook', async () => {
  const server = archiveServer({ a: bookRecord('a'), b: bookRecord('b') });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  localStorage.setItem('sidechannel-reviewer', 'Lead');
  render(<CodebookPage />); const user = userEvent.setup();
  await screen.findByDisplayValue('Book a');
  await user.click(await enabledButton(/Archive codebook/));
  expect(confirm.mock.calls[0][0]).toMatch(/Existing analyses are unaffected.*cannot be used for new analyses until it is restored/);
  await screen.findByText(/Codebook archived/);
  expect(server.calls.find(c => c.path.endsWith('/archive'))).toMatchObject({ method: 'POST', body: { expectedRevisionId: 'rev-a', actor: 'Lead' } });
  await waitFor(() => expect((screen.getByRole('textbox', { name: /Codebook name/ }) as HTMLInputElement).value).toBe('Book b'));
  expect(screen.queryByRole('option', { name: /Book a/ })).toBeNull();
});
it('shows the existing empty state when the last active codebook is archived', async () => {
  archiveServer({ a: bookRecord('a') });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  localStorage.setItem('sidechannel-reviewer', 'Lead');
  render(<CodebookPage />); const user = userEvent.setup();
  await screen.findByDisplayValue('Book a');
  await user.click(await enabledButton(/Archive codebook/));
  await screen.findByText('Create the study codebook');
  await user.click(screen.getByRole('button', { name: /Show archived codebooks/ }));
  await screen.findByRole('option', { name: /Book a · archived/ });
  await enabledButton(/Restore codebook/);
});
it('does not archive when the confirmation is declined and explains the missing author', async () => {
  const server = archiveServer({ a: bookRecord('a') });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<CodebookPage />); const user = userEvent.setup();
  await screen.findByDisplayValue('Book a');
  const button = screen.getByRole('button', { name: /Archive codebook/ });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Enter a revision author to archive/)).toBeTruthy();
  await user.type(screen.getByLabelText(/Revision author/), 'Lead');
  await user.click(button);
  expect(confirm).toHaveBeenCalled();
  expect(server.calls.some(c => c.path.endsWith('/archive'))).toBe(false);
});
it('blocks archiving while there are unsaved edits', async () => {
  const server = archiveServer({ a: bookRecord('a') });
  localStorage.setItem('sidechannel-reviewer', 'Lead');
  render(<CodebookPage />); const user = userEvent.setup();
  const field = await screen.findByLabelText('Definition'); await user.type(field, ' edited');
  expect((screen.getByRole('button', { name: /Archive codebook/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Save or discard your unsaved edits before archiving/)).toBeTruthy();
  expect(server.calls.some(c => c.path.endsWith('/archive'))).toBe(false);
});
it('lists archived codebooks on request, makes them read-only, and restores them', async () => {
  const server = archiveServer({ a: bookRecord('a'), b: bookRecord('b', { archivedAt: '2026-11-08T00:00:00Z', archivedBy: 'Lead' }) });
  localStorage.setItem('sidechannel-reviewer', 'Lead');
  render(<CodebookPage />); const user = userEvent.setup();
  await screen.findByDisplayValue('Book a');
  expect(screen.queryByRole('option', { name: /archived/ })).toBeNull();
  expect(server.calls.find(c => c.path.startsWith('/api/jev/codebooks?'))!.path).not.toContain('archived=');
  await user.click(screen.getByLabelText('Show archived'));
  await screen.findByRole('option', { name: /Book b · archived/ });
  expect(server.calls.some(c => c.path.includes('archived=include'))).toBe(true);
  await user.selectOptions(screen.getByLabelText('Codebook'), 'b');
  await screen.findByText(/This codebook is archived/);
  expect(screen.getByText(/by Lead/)).toBeTruthy();
  expect(screen.getByLabelText('Definition').matches(':disabled')).toBe(true);
  expect((screen.getByLabelText('Add behavior code') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Save revision' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(await enabledButton(/Restore codebook/));
  await screen.findByText(/Codebook restored/);
  expect(server.calls.find(c => c.path.endsWith('/restore'))).toMatchObject({ method: 'POST', body: { expectedRevisionId: 'rev-b', actor: 'Lead' } });
  await waitFor(() => expect(screen.getByLabelText('Definition').matches(':disabled')).toBe(false));
});
it('shows the server message when archiving conflicts', async () => {
  const server = archiveServer({ a: bookRecord('a') });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  localStorage.setItem('sidechannel-reviewer', 'Lead');
  render(<CodebookPage />); const user = userEvent.setup();
  await screen.findByDisplayValue('Book a');
  server.books.a.currentRevisionId = 'rev-newer';
  await user.click(await enabledButton(/Archive codebook/));
  await screen.findByText('Codebook revision conflict');
  expect(screen.queryByText(/Another researcher saved a newer revision/)).toBeNull();
});
