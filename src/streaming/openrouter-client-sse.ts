import type { OpenRouterTextStreamPayload } from './openrouter-stream-chunks.ts';

type Chunk = Extract<OpenRouterTextStreamPayload, { kind: 'delta' | 'usage' }>;

function unsupported(): never {
  throw new Error('Unsupported OpenRouter text stream event');
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function frame(value: object): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function base(event: Chunk): object {
  if (
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
  };
}

/** Project a validated text event into one client SSE frame. Missing usage has no frame. */
export function encodeOpenRouterTextSse(event: OpenRouterTextStreamPayload): string | undefined {
  if (event.kind === 'done') return 'data: [DONE]\n\n';
  if (event.kind === 'error') unsupported();
  if (event.kind === 'delta') {
    if (
      (event.role !== undefined && event.role !== 'assistant') ||
      (event.content !== undefined &&
        event.content !== null &&
        typeof event.content !== 'string') ||
      (event.finishReason !== null &&
        event.finishReason !== 'stop' &&
        event.finishReason !== 'length' &&
        event.finishReason !== 'content_filter')
    )
      unsupported();
    return frame({
      ...base(event),
      choices: [
        {
          index: 0,
          delta: {
            ...(event.role === undefined ? {} : { role: event.role }),
            ...(event.content === undefined ? {} : { content: event.content }),
          },
          finish_reason: event.finishReason,
        },
      ],
    });
  }
  if (event.kind === 'usage') {
    const usage = event.usage;
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
      event.finishReason !== 'content_filter'
    )
      unsupported();
    return frame({
      ...base(event),
      choices:
        event.finishReason === null
          ? []
          : [
              {
                index: 0,
                delta: { role: 'assistant', content: '' },
                finish_reason: event.finishReason,
              },
            ],
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      },
    });
  }
  return unsupported();
}
