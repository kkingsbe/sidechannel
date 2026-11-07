// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CodebookPage from './Codebook';
import { activate, fakeServer, renderWithServer } from '../test/clients';

const definition = { id:'supply', code:'SUPPLY', name:'Supply', definition:'Original definition', inclusionCriteria:[], exclusionCriteria:[], examples:[], counterexamples:[], qualifyingEvidenceTypes:[], enabled:true, archived:false, color:'#123456' };
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('preserves conflicting local edits for explicit reconciliation against the latest revision', async () => {
  let revision = 1;
  const submissions: any[] = [];
  const viewRev = (number:number) => ({id:'revision-'+number, codebookId:'book', revision:number, createdAt:'2026-11-07T12:00:00Z', author:'Researcher', codes:number===1?[definition]:[{...definition,definition:'Teammate definition'},{...definition,id:'new',code:'NEW',name:'Added by teammate'}]});
  const viewBook = (number:number) => ({id:'book', name:'Study', currentRevisionId:'revision-'+number, archived:false, revision:number});
  activate(fakeServer((path, options) => {
    if (path === '/codebooks' || path.startsWith('/codebooks?')) return {items:[viewBook(revision)],nextCursor:null};
    if (path==='/codebooks/book' && options?.method==='PATCH') {
      const submitted=JSON.parse(String(options.body)); submissions.push(submitted);
      if (revision===1) {revision=2;throw Object.assign(new Error('Codebook revision conflict'), { status: 409 });}
      return {codebook:viewBook(3),revision:viewRev(3)};
    }
    if(path==='/codebooks/book') return {codebook:viewBook(revision), revision:viewRev(revision)};
    if(path.startsWith('/codebooks/book/revisions/')) return viewRev(Number(path.split('-').at(-1)));
    throw new Error('Unexpected request '+path);
  }));
  renderWithServer(<MemoryRouter><CodebookPage/></MemoryRouter>); const user=userEvent.setup();
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
