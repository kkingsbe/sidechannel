/**
 * Shared types for the model-call fold (see `model-calls.ts`). No React, no I/O.
 */
import type { HarnessEvent } from '@sidechannel/contracts/browser';

export interface ReasoningPart {
  text: string;
  /** Where the text was found, e.g. `raw.steps[0].reasoning[1]` or `reasoning`. */
  source: string;
  /** True only when the provider explicitly marked the part as a summary. */
  summary: boolean;
}

export type ReasoningState = 'scripted' | 'returned' | 'summary' | 'hidden' | 'not_returned' | 'unknown';

export type ToolCallStatus = 'proposed' | 'admitted' | 'executed' | 'unexecuted' | 'failed' | 'deduplicated';

export interface ProposedToolCall {
  id: string;
  name: string;
  arguments: unknown;
  status: ToolCallStatus;
  /** The lifecycle event that determined `status` (absent for `proposed`). */
  statusEvent?: { id: string; sequence: number };
  /** Reason text for unexecuted / failed calls. */
  reason?: string;
}

export interface ModelCallTokens {
  /** Estimated/measured input context size from `context_accounted`. */
  context?: number;
  input?: number;
  output?: number;
  reasoning?: number;
}

export interface ModelCall {
  invocationId: string;
  agentId?: string;
  phase?: string;
  round?: number;
  turn?: number;
  /** 1-based position of this call among the calls of the input, ordered by first event sequence. */
  ordinal: number;
  request?: HarnessEvent;
  response?: HarnessEvent;
  usage?: HarnessEvent;
  context?: HarnessEvent;
  /** [min, max] event sequence across every event of this call (incl. tool lifecycle). */
  sequenceRange: [number, number];
  startedAt: string;
  finishedAt: string;
  /** Milliseconds between model_requested and model_response timestamps. */
  latencyMs?: number;
  /** Assistant text output ('' when none or when the response is missing). */
  text: string;
  reasoning: ReasoningPart[];
  reasoningState: ReasoningState;
  tokens: ModelCallTokens;
  finishReason?: string;
  toolCalls: ProposedToolCall[];
  inputSummary?: { messages: number; tools: number };
  /**
   * Set when the call never got a response and the same turn (or the run) then ended with an
   * error, e.g. a model request timeout. `elapsedMs` runs from the request to that ending.
   */
  failure?: { reason: string; elapsedMs?: number; event: HarnessEvent };
}

/** Event types that belong to a model call; the timeline folds these into one row. */
export const MODEL_CALL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'context_accounted',
  'model_requested',
  'model_response',
  'model_usage',
]);

/** Where the visible page sits in the run's event stream; passed by the page that owns paging. */
export interface PageNav {
  hasPrevious: boolean;
  hasNext: boolean;
  /** Jump to the newest page; shown only when `hasNext`. */
  onJumpToLatest?: () => void;
}

/* ------------------------------------------------- internal primitives (shared by the split modules) */

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
