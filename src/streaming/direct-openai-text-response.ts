import {
  DirectProviderFailure,
  type DirectProviderFailureCategory,
} from '../routing/invoke-jev-managed-route.ts';
import {
  decodeOpenRouterStreamPayload,
  type OpenRouterTextStreamPayload,
  type StreamModelScope,
} from './openrouter-stream-chunks.ts';
import {
  type OpenRouterTextStreamOutcome,
  OpenRouterTextStreamSequence,
} from './openrouter-stream-sequence.ts';
import { parseSseDataEvents } from './parse-sse-data-events.ts';
import { waitForStreamOperation } from './wait-for-stream-operation.ts';

type NativeDelta = Omit<
  Extract<OpenRouterTextStreamPayload, { kind: 'delta' }>,
  'reasoning' | 'reasoningDetails' | 'nativeFinishReason'
>;
type NativeUsage = Omit<
  Extract<OpenRouterTextStreamPayload, { kind: 'usage' }>,
  'nativeFinishReason'
>;
export type DirectOpenAITextStreamPayload =
  | NativeDelta
  | NativeUsage
  | Extract<OpenRouterTextStreamPayload, { kind: 'done' | 'error' }>;
export type DirectOpenAITextStreamCompletion = Omit<
  Extract<OpenRouterTextStreamOutcome, { status: 'complete' }>,
  'nativeFinishReason'
>;
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Native text subset: ordinary null usage is not a final usage event. */
export function decodeDirectOpenAITextPayload(
  payload: string,
  scope: StreamModelScope,
): DirectOpenAITextStreamPayload {
  try {
    if (payload === '[DONE]') return decodeOpenRouterStreamPayload(payload, scope);
    const value = record(JSON.parse(payload) as unknown);
    if (!value) throw Error();
    if (Object.hasOwn(value, 'error')) return Object.freeze({ kind: 'error' });
    if (!Array.isArray(value.choices)) throw Error();
    if (value.choices.length > 0) {
      if (value.choices.length !== 1) throw Error();
      const choice = record(value.choices[0]),
        delta = record(choice?.delta);
      if (
        !choice ||
        !delta ||
        Object.hasOwn(choice, 'native_finish_reason') ||
        Object.keys(delta).some((key) => !['role', 'content', 'refusal'].includes(key))
      )
        throw Error();
      if (Object.hasOwn(value, 'usage')) {
        if (value.usage !== null) throw Error();
        delete value.usage;
      }
    }
    // Reuse common structural and usage validation only after native guards.
    return decodeOpenRouterStreamPayload(JSON.stringify(value), scope);
  } catch {
    throw new Error('Invalid direct OpenAI stream chunk');
  }
}
function fail(response: Response, category: DirectProviderFailureCategory): never {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    /* Cleanup cannot delay or replace a fixed failure. */
  }
  throw new DirectProviderFailure(category, true, true);
}

/** Consume one already-authorized native response; never retain response content. */
export async function consumeDirectOpenAITextResponse(
  response: Response,
  scope: StreamModelScope,
  onDelta: (delta: NativeDelta) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<DirectOpenAITextStreamCompletion> {
  if (response.status !== 200)
    return fail(
      response,
      response.status === 429 ? 'rate-limit' : response.status >= 500 ? 'server-error' : 'other',
    );
  if (
    response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'text/event-stream' ||
    !response.body
  )
    return fail(response, 'other');
  try {
    const fixedScope = Object.freeze({
      upstreamModelId: scope.upstreamModelId,
      clientModelAlias: scope.clientModelAlias,
    });
    const sequence = new OpenRouterTextStreamSequence();
    let created: number | undefined;
    for await (const data of parseSseDataEvents(response.body, undefined, signal)) {
      const event = decodeDirectOpenAITextPayload(data, fixedScope);
      if ('created' in event) {
        if (created !== undefined && event.created !== created) throw Error();
        created = event.created;
      }
      sequence.accept(event);
      if (event.kind === 'delta')
        await waitForStreamOperation(Promise.resolve(onDelta(event)), signal);
      if (event.kind === 'done' || event.kind === 'error') break;
    }
    const result = sequence.finish();
    if (result.status !== 'complete') return fail(response, 'other');
    return result;
  } catch {
    return fail(response, 'other');
  }
}
