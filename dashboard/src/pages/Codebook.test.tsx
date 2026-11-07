// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../lib/api';
import { fakeClients, renderWithClients } from '../test/clients';
import type { BehaviorCode } from '../lib/analysis-types';
import CodebookPage from './Codebook';

const definition: BehaviorCode = { id:'supply', code:'SUPPLY', name:'Supply', definition:'Original definition', inclusionCriteria:[], exclusionCriteria:[], examples:[], counterexamples:[], qualifyingEvidenceTypes:[], enabled:true, archived:false, color:'#123456' };
const revisionRecord = (number:number) => ({id:'revision-'+number, codebookId:'book', revision:number, createdAt:'2026-11-07T12:00:00Z', author:'Researcher', codes: number===1?[definition]:[{...definition,definition:'Teammate definition'},{...definition,id:'new',code:'NEW',name:'Added by teammate'}]});
const viewBook = (number:number) => ({id:'book', name:'Study', currentRevisionId:'revision-'+number, archived:false, revision:number, createdAt:'2026-11-07T12:00:00Z'});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it('preserves conflicting local edits for explicit reconciliation against the latest revision', async () => {
  let revision = 1;
  const submissions: any[] = [];
  const clients = fakeClients({
    codebooks: {
      list: async () => ({ items: [viewBook(revision)], nextCursor: null }),
      get: async () => ({ codebook: viewBook(revision), revision: revisionRecord(revision) }),
      revisions: async () => ({ items: [], nextCursor: null }),
      revise: async (_id: string, input: { expectedRevisionId: string; name: string; codes: BehaviorCode[]; author: string }) => {
        submissions.push({ expectedRevisionId: input.expectedRevisionId, definitions: input.codes, name: input.name });
        if (revision === 1) { revision = 2; throw new ApiError(409, 'Codebook revision conflict'); }
        return { codebook: viewBook(3), revision: { ...revisionRecord(3), codes: input.codes } };
      },
    },
  });
  renderWithClients(<CodebookPage />, { clients });
  const user = userEvent.setup();
  const field = await screen.findByLabelText('Definition');
  await user.clear(field);
  await user.type(field, 'My preserved changes');
  await user.type(screen.getByLabelText('Revision author'), 'Reviewer');
  await user.click(screen.getByRole('button', { name: 'Save revision' }));
  await user.click(await screen.findByRole('button', { name: 'Load latest for reconciliation' }));
  await screen.findByRole('heading', { name: 'Recover edits from an older revision' });
  expect((screen.getByLabelText('Definition') as HTMLTextAreaElement).value).toBe('Teammate definition');
  await user.click(screen.getByRole('button', { name: 'Restore local edits for reconciliation' }));
  expect((screen.getByLabelText('Definition') as HTMLTextAreaElement).value).toBe('My preserved changes');
  await user.click(screen.getByRole('button', { name: 'Save revision' }));
  await screen.findByText('New immutable codebook revision saved. Existing analyses keep their frozen definitions.');
  expect(submissions.map((value) => value.expectedRevisionId)).toEqual(['revision-1', 'revision-2']);
  expect(submissions[1].definitions.map((value: BehaviorCode) => value.id)).toEqual(['supply', 'new']);
});
