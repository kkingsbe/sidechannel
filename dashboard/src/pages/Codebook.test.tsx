// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CodebookPage from './Codebook';

const definition = { id:'supply', code:'SUPPLY', name:'Supply', definition:'Original definition', inclusionCriteria:[], exclusionCriteria:[], examples:[], counterexamples:[], qualifyingEvidenceTypes:[], enabled:true, archived:false, color:'#123456' };
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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

it('starts new behaviors empty, flags a missing author, and clears the success notice on the next edit', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path:string, options?:RequestInit) => {
    const rev = {id:'revision-1', codebookId:'book', revision:1, createdAt:'2026-11-07T12:00:00Z', createdBy:'Researcher', definitions:[{...definition,code:'SUPPLY',name:'SUPPLY'}]};
    let value:unknown;
    if (path.startsWith('/api/jev/codebooks?')) value={items:[{id:'book',name:'Study',currentRevisionId:'revision-1'}],nextCursor:null};
    else if (path==='/api/jev/codebooks/book' && options?.method==='PATCH') { const s=JSON.parse(String(options.body)); value={codebook:{id:'book',name:s.name,currentRevisionId:'revision-1'},revision:{...rev,definitions:s.definitions}}; }
    else if (path==='/api/jev/codebooks/book') value={id:'book',name:'Study',currentRevisionId:'revision-1'};
    else if (path.startsWith('/api/jev/codebooks/book/revisions/')) value=rev;
    else throw new Error('Unexpected request '+path);
    return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
  }));
  render(<CodebookPage/>); const user=userEvent.setup();
  const field=await screen.findByLabelText('Definition');
  await user.type(field,' more');
  expect(screen.getByLabelText('Revision author').getAttribute('aria-invalid')).toBe('true');
  expect(screen.getAllByText('Enter a revision author to save your changes.').length).toBeGreaterThan(0);
  await user.type(screen.getByLabelText('Revision author'),'Reviewer');
  await user.click(screen.getByRole('button',{name:'Save revision'}));
  await screen.findByText(/New immutable codebook revision saved/);
  await user.type(screen.getByLabelText('Definition'),'!');
  expect(screen.queryByText(/New immutable codebook revision saved/)).toBeNull();
  await user.click(screen.getByRole('button',{name:'Add behavior code'}));
  expect((screen.getByLabelText(/Display code/) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(/Display name/) as HTMLInputElement).value).toBe('');
  expect(screen.getByLabelText(/Display name/).getAttribute('placeholder')).toMatch(/Proposes a prohibited route/);
});
