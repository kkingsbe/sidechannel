/**
 * Tool-call status normalization for the model-call fold. Split out of `model-calls.ts`;
 * public names are re-exported there.
 */
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { isRecord, str, type ProposedToolCall, type ToolCallStatus } from './model-calls-types';

const TOOL_STATUS_BY_EVENT: Record<string, ToolCallStatus> = {
  tool_requested: 'proposed',
  tool_admitted: 'admitted',
  tool_result: 'executed',
  tool_unexecuted: 'unexecuted',
  tool_failed: 'failed',
  tool_deduplicated: 'deduplicated',
};

export function isToolStatusEvent(type: string): boolean {
  return type in TOOL_STATUS_BY_EVENT;
}

function reasonOf(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const r = data.reason ?? data.error;
  return typeof r === 'string' ? r : undefined;
}

/** The latest tool lifecycle event for `id` decides that call's status (proposed when none). */
export function resolveToolStatus(
  events: HarnessEvent[],
  id: string,
): Pick<ProposedToolCall, 'status' | 'statusEvent' | 'reason'> {
  let latest: HarnessEvent | undefined;
  for (const e of events) if (e.toolCallId === id && e.type in TOOL_STATUS_BY_EVENT) latest = e;
  if (!latest) return { status: 'proposed' };
  const reason = reasonOf(latest.data);
  return {
    status: TOOL_STATUS_BY_EVENT[latest.type],
    statusEvent: { id: latest.id, sequence: latest.sequence },
    ...(reason ? { reason } : {}),
  };
}

export { str };
