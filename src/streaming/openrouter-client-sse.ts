import { snapshotChatUsage } from '../providers/chat-usage.ts';
import { snapshotReasoningDetails } from '../providers/reasoning-details.ts';
import {
  type OpenRouterFunctionStreamPayload,
  type OpenRouterTextStreamPayload,
  snapshotFunctionCallFragments,
} from './openrouter-stream-chunks.ts';

type Chunk = Extract<OpenRouterFunctionStreamPayload, { kind: 'delta' | 'usage' }>;

function unsupported(): never {
  throw new Error('Unsupported OpenRouter text stream event');
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function frame(value: object): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function validTier(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function base(event: Chunk, serviceTier: unknown): object {
  const systemFingerprint = event.systemFingerprint;
  if (
    (systemFingerprint !== undefined &&
      systemFingerprint !== null &&
      typeof systemFingerprint !== 'string') ||
    !validTier(serviceTier) ||
    typeof event.id !== 'string' ||
    !event.id ||
    event.id.length > 256 ||
    !Number.isSafeInteger(event.created) ||
    event.created < 0 ||
    typeof event.model !== 'string' ||
    !event.model
  )
    unsupported();
  return {
    id: event.id,
    object: 'chat.completion.chunk',
    created: event.created,
    model: event.model,
    ...(systemFingerprint === undefined ? {} : { system_fingerprint: systemFingerprint }),
    ...(serviceTier === undefined ? {} : { service_tier: serviceTier }),
  };
}

/** Project a validated text event into one client SSE frame. Missing usage has no frame. */
export function encodeOpenRouterTextSse(event: OpenRouterTextStreamPayload): string | undefined {
  return encodeSse(event, false);
}

/** Project validated function fragments without assembly or argument parsing. */
export function encodeOpenRouterFunctionSse(
  event: OpenRouterFunctionStreamPayload,
): string | undefined {
  return encodeSse(event, true);
}

function encodeSse(event: OpenRouterFunctionStreamPayload, functions: boolean): string | undefined {
  const hasCalls = Object.hasOwn(event, 'toolCalls');
  if (hasCalls && (!functions || event.kind !== 'delta')) unsupported();
  let calls: ReturnType<typeof snapshotFunctionCallFragments> | undefined;
  if (hasCalls && event.kind === 'delta') {
    try {
      calls = snapshotFunctionCallFragments(event.toolCalls, true);
    } catch {
      unsupported();
    }
  }
  if (event.kind === 'done') return 'data: [DONE]\n\n';
  if (event.kind === 'error') unsupported();
  const content = 'content' in event ? event.content : undefined;
  const refusal = 'refusal' in event ? event.refusal : undefined;
  const reasoning = 'reasoning' in event ? event.reasoning : undefined;
  const nativeFinishReason = event.nativeFinishReason;
  if (
    nativeFinishReason !== undefined &&
    nativeFinishReason !== null &&
    typeof nativeFinishReason !== 'string'
  )
    unsupported();
  const nativeChoice =
    nativeFinishReason === undefined ? {} : { native_finish_reason: nativeFinishReason };
  if (event.kind === 'delta') {
    const hasDetails = Object.hasOwn(event, 'reasoningDetails');
    const details = hasDetails ? snapshotReasoningDetails(event.reasoningDetails) : undefined;
    if (hasDetails && details === undefined) unsupported();
    if (
      (event.role !== undefined && event.role !== 'assistant') ||
      (reasoning !== undefined && reasoning !== null && typeof reasoning !== 'string') ||
      (refusal !== undefined && refusal !== null && typeof refusal !== 'string') ||
      (content !== undefined && content !== null && typeof content !== 'string') ||
      (event.finishReason !== null &&
        event.finishReason !== 'stop' &&
        event.finishReason !== 'length' &&
        event.finishReason !== 'content_filter' &&
        !(functions && event.finishReason === 'tool_calls'))
    )
      unsupported();
    return frame({
      ...base(event, event.serviceTier),
      choices: [
        {
          index: 0,
          delta: {
            ...(event.role === undefined ? {} : { role: event.role }),
            ...(content === undefined ? {} : { content }),
            ...(refusal === undefined ? {} : { refusal }),
            ...(reasoning === undefined ? {} : { reasoning }),
            ...(details === undefined ? {} : { reasoning_details: details }),
            ...(calls === undefined ? {} : { tool_calls: calls }),
          },
          finish_reason: event.finishReason,
          ...nativeChoice,
        },
      ],
    });
  }
  if (event.kind === 'usage') {
    if (Object.hasOwn(event, 'reasoningDetails')) unsupported();
    const serviceTier = event.serviceTier;
    if (!validTier(serviceTier)) unsupported();
    if (content !== undefined && content !== null && content !== '') unsupported();
    if (refusal !== undefined && refusal !== null && refusal !== '') unsupported();
    if (reasoning !== undefined && reasoning !== null && reasoning !== '') unsupported();
    const usage = snapshotChatUsage(event.usage);
    if (
      !validCount(usage?.prompt_tokens) ||
      !validCount(usage.completion_tokens) ||
      !validCount(usage.total_tokens)
    )
      return undefined;
    if (
      event.finishReason !== null &&
      event.finishReason !== 'stop' &&
      event.finishReason !== 'length' &&
      event.finishReason !== 'content_filter' &&
      !(functions && event.finishReason === 'tool_calls')
    )
      unsupported();
    return frame({
      ...base(event, serviceTier),
      choices:
        event.finishReason === null
          ? []
          : [
              {
                index: 0,
                delta: { role: 'assistant', content: '' },
                finish_reason: event.finishReason,
                ...nativeChoice,
              },
            ],
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        ...(usage.prompt_tokens_details === undefined
          ? {}
          : { prompt_tokens_details: usage.prompt_tokens_details }),
        ...(usage.completion_tokens_details === undefined
          ? {}
          : { completion_tokens_details: usage.completion_tokens_details }),
      },
    });
  }
  return unsupported();
}
