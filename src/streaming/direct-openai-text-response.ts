import {
  DirectProviderFailure,
  type DirectProviderFailureCategory,
} from '../routing/invoke-jev-managed-route.ts';
import { normalizeDirectOpenAIStreamEnvelope } from './direct-openai-stream-envelope.ts';
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
/** Native text subset: ordinary null usage is not a final usage event. */
export function decodeDirectOpenAITextPayload(
  payload: string,
  scope: StreamModelScope,
): DirectOpenAITextStreamPayload {
  try {
    return decodeOpenRouterStreamPayload(normalizeDirectOpenAIStreamEnvelope(payload), scope);
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
  const sequence = new OpenRouterTextStreamSequence();
  try {
    const fixedScope = Object.freeze({
      upstreamModelId: scope.upstreamModelId,
      clientModelAlias: scope.clientModelAlias,
    });
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
    sequence.discard();
    return fail(response, 'other');
  }
}
