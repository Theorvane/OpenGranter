import type { ChatRequest } from '../gateway/chat-handler.ts';
import type { OpenRouterTextStreamPayload } from '../streaming/openrouter-stream-chunks.ts';
import { consumeOpenRouterTextResponse } from '../streaming/openrouter-stream-response.ts';
import type { OpenRouterTextStreamOutcome } from '../streaming/openrouter-stream-sequence.ts';
import {
  invokeOpenRouterChatTransport,
  type OpenRouterChatAttempt,
  OpenRouterChatFailure,
  type OpenRouterChatPorts,
} from './openrouter-chat.ts';

type Delta = Extract<OpenRouterTextStreamPayload, { kind: 'delta' }>;
type Complete = Extract<OpenRouterTextStreamOutcome, { status: 'complete' }>;

/** Invoke one authorized delegated text stream without exposing client streaming yet. */
export function createOpenRouterTextStreamInvoker(
  ports: OpenRouterChatPorts,
): (
  attempt: OpenRouterChatAttempt,
  request: ChatRequest,
  onDelta: (delta: Delta) => void | Promise<void>,
) => Promise<Complete> {
  return async (attempt, request, onDelta) => {
    const { prepared, response, timeout } = await invokeOpenRouterChatTransport(
      ports,
      attempt,
      request,
      true,
    );
    try {
      return await consumeOpenRouterTextResponse(
        response,
        {
          upstreamModelId: prepared.attempt.upstreamModelId,
          clientModelAlias: prepared.clientModelAlias,
        },
        onDelta,
      );
    } catch (error) {
      if (timeout.aborted) throw new OpenRouterChatFailure('timeout', true, true);
      if (error instanceof OpenRouterChatFailure) throw error;
      throw new OpenRouterChatFailure('upstream', true, true);
    }
  };
}
