// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RUN_STATUSES, isTerminalRun } from '@sidechannel/contracts/browser';
import {
  agreementMeta,
  analysisSourceReady,
  eventMeta,
  jobStatusMeta,
  jobStatusMetaFor,
  monitorStatusMeta,
  monitorStatusMetaFor,
  overviewCards,
  reviewDecisionMeta,
  runListGroups,
  runStatusMeta,
  runStatusMetaFor,
  windowStatusMeta,
} from './status';

describe('run status vocabulary', () => {
  it('covers every run status exactly once', () => {
    expect(Object.keys(runStatusMeta).sort()).toEqual([...RUN_STATUSES].sort());
  });
  it('agrees with the domain terminal predicate', () => {
    for (const status of RUN_STATUSES)
      expect([status, runStatusMeta[status].group !== 'active']).toEqual([status, isTerminalRun(status)]);
  });
  it('keeps the tones the workspace rendered before WS7', () => {
    expect(runStatusMeta.completed.tone).toBe('success');
    expect(runStatusMeta.failed.tone).toBe('danger');
    expect(runStatusMeta.running.tone).toBe('warning');
    expect(runStatusMeta.queued.tone).toBe('warning');
    expect(runStatusMeta.stopping.tone).toBe('neutral');
    expect(runStatusMeta.cancelled.tone).toBe('neutral');
    expect(runStatusMeta.interrupted.tone).toBe('neutral');
    expect(reviewDecisionMeta.present.tone).toBe('success');
    expect(reviewDecisionMeta.absent.tone).toBe('neutral');
    expect(reviewDecisionMeta.uncertain.tone).toBe('warning');
  });
  it('keeps the shipped fallbacks neutral instead of inventing a status', () => {
    expect(runStatusMetaFor('not-a-status')).toEqual({ label: 'not-a-status', tone: 'neutral', group: 'attention', analysisSource: false });
    expect(monitorStatusMetaFor('not-a-status')).toEqual({ label: 'not-a-status', tone: 'neutral', active: false });
    expect(jobStatusMetaFor('not-a-status')).toEqual({ label: 'not-a-status', tone: 'neutral', active: false, retryOffered: false });
  });
  it('marks only frozen source-run states as analysable', () => {
    const ready = RUN_STATUSES.filter(status => analysisSourceReady(status));
    expect(ready.sort()).toEqual(['cancelled', 'completed', 'failed']);
  });
  it('styles an oversized projection as a warning, never as a failure', () => {
    expect(monitorStatusMeta.oversized).toEqual({ label: 'oversized', tone: 'warning', active: false });
  });
  it('keeps the page groupings narrow and internally non-overlapping', () => {
    expect(runListGroups.map(group => group.label)).toEqual(['Active runs', 'Needs attention']);
    expect(runListGroups[0]!.statuses).toEqual(['running', 'reporting', 'stopping']);
    expect(runListGroups[1]!.statuses).toEqual(['failed', 'interrupted']);
    expect(overviewCards.map(card => card.label)).toEqual(['Active runs', 'Queued runs', 'Completed runs', 'Needs attention']);
    for (const group of [...runListGroups, ...overviewCards]) {
      expect(new Set(group.statuses).size).toBe(group.statuses.length);
      for (const status of group.statuses) expect(RUN_STATUSES).toContain(status);
    }
  });
  it('covers every display status of jobs, windows, agreements and monitor results', () => {
    expect(Object.keys(jobStatusMeta).sort()).toEqual(['cancelled', 'completed', 'failed', 'partial', 'preparing', 'queued', 'running']);
    expect(Object.keys(windowStatusMeta).sort()).toEqual(['completed', 'failed', 'oversized', 'pending', 'running', 'skipped']);
    expect(Object.keys(agreementMeta).sort()).toEqual(['agreed', 'disagreement', 'provisional']);
    expect(Object.keys(monitorStatusMeta).sort()).toEqual(['cancelled', 'completed', 'failed', 'oversized', 'partial', 'pending', 'queued', 'ready', 'running']);
  });
});

describe('event vocabulary', () => {
  it('derives label, tone and icon from the event type only', () => {
    expect(eventMeta({ type: 'board_post' })).toEqual({ label: 'board post', tone: 'neutral', icon: 'board' });
    expect(eventMeta({ type: 'tool_denied' })).toEqual({ label: 'tool denied', tone: 'danger', icon: 'error' });
    expect(eventMeta({ type: 'tool_result' })).toEqual({ label: 'tool result', tone: 'neutral', icon: 'tool' });
    expect(eventMeta({ type: 'artifact_frozen' })).toEqual({ label: 'artifact frozen', tone: 'neutral', icon: 'default' });
    expect(eventMeta({ type: 'turn_started' })).toEqual({ label: 'turn started', tone: 'neutral', icon: 'default' });
    expect(eventMeta({ type: 'run_completed' })).toEqual({ label: 'run completed', tone: 'neutral', icon: 'success' });
  });
});
