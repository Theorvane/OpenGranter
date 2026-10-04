import type { ChatRequest } from '../gateway/chat-handler.ts';
import { consumeOpenRouterFunctionResponse } from '../streaming/openrouter-function-stream-response.ts';
import type { OpenRouterFunctionStreamOutcome } from '../streaming/openrouter-function-stream-sequence.ts';
import type { OpenRouterFunctionStreamPayload } from '../streaming/openrouter-stream-chunks.ts';
import {
  invokeOpenRouterFunctionStreamTransport,
  type OpenRouterChatAttempt,
  OpenRouterChatFailure,
  type OpenRouterChatPorts,
} from './openrouter-chat.ts';

type Delta = Extract<OpenRouterFunctionStreamPayload, { kind: 'delta' }>;
type Complete = Extract<OpenRouterFunctionStreamOutcome, { status: 'complete' }>;

/** Invoke one authorized delegated function stream without exposing client streaming yet. */
export function createOpenRouterFunctionStreamInvoker(
  ports: OpenRouterChatPorts,
): (
  attempt: OpenRouterChatAttempt,
  request: ChatRequest,
  onDelta: (delta: Delta) => void | Promise<void>,
  cancellation?: AbortSignal,
) => Promise<Complete> {
  return async (attempt, request, onDelta, cancellation) => {
    const { prepared, response, timeout, signal } = await invokeOpenRouterFunctionStreamTransport(
      ports,
      attempt,
      request,
      cancellation,
    );
    try {
      return await consumeOpenRouterFunctionResponse(
        response,
        {
          upstreamModelId: prepared.attempt.upstreamModelId,
          clientModelAlias: prepared.clientModelAlias,
        },
        onDelta,
        signal,
      );
    } catch (error) {
      if (timeout.aborted) throw new OpenRouterChatFailure('timeout', true, true);
      if (error instanceof OpenRouterChatFailure) throw error;
      throw new OpenRouterChatFailure('upstream', true, true);
    }
  };
}
