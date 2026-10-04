import {
  OpenRouterChatFailure,
  type OpenRouterFailureCategory,
} from '../providers/openrouter-chat.ts';
import { consumeOpenRouterFunctionStream } from './openrouter-function-stream-consumer.ts';
import type { OpenRouterFunctionStreamOutcome } from './openrouter-function-stream-sequence.ts';
import type {
  OpenRouterFunctionStreamPayload,
  StreamModelScope,
} from './openrouter-stream-chunks.ts';

type Delta = Extract<OpenRouterFunctionStreamPayload, { kind: 'delta' }>;
type Complete = Extract<OpenRouterFunctionStreamOutcome, { status: 'complete' }>;

function fail(response: Response, category: OpenRouterFailureCategory): never {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // Cancellation is best-effort; it must not hide or stall the safe failure.
  }
  throw new OpenRouterChatFailure(category, true, true);
}

/** Validate one upstream HTTP response before consuming its scoped SSE body. */
export async function consumeOpenRouterFunctionResponse(
  response: Response,
  scope: StreamModelScope,
  onDelta: (delta: Delta) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<Complete> {
  if (response.status !== 200) {
    const category =
      response.status === 429 ? 'rate-limit' : response.status >= 500 ? 'server-error' : 'upstream';
    return fail(response, category);
  }
  if (
    response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'text/event-stream' ||
    !response.body
  )
    return fail(response, 'upstream');

  let result: OpenRouterFunctionStreamOutcome;
  try {
    result = await consumeOpenRouterFunctionStream(response.body, scope, onDelta, signal);
  } catch {
    return fail(response, 'upstream');
  }
  if (result.status === 'failed') return fail(response, 'upstream');
  return result;
}
