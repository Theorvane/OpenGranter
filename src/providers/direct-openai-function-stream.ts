import type { ChatRequest } from '../gateway/chat-handler.ts';
import type { RouteCandidate } from '../routing/authorize-candidates.ts';
import { DirectProviderFailure } from '../routing/invoke-jev-managed-route.ts';
import {
  consumeDirectOpenAIFunctionResponse,
  type DirectOpenAIFunctionStreamCompletion,
  type DirectOpenAIFunctionStreamPayload,
} from '../streaming/direct-openai-function-response.ts';
import { createDirectChatTransport, type DirectChatPorts } from './direct-chat.ts';

type Delta = Extract<DirectOpenAIFunctionStreamPayload, { kind: 'delta' }>;

/** Internal adapter only: the caller must supply an already-authorized candidate. */
export function createDirectOpenAIFunctionStreamInvoker(
  ports: DirectChatPorts,
): (
  candidate: RouteCandidate,
  request: ChatRequest,
  onDelta: (delta: Delta) => void | Promise<void>,
  cancellation?: AbortSignal,
) => Promise<DirectOpenAIFunctionStreamCompletion> {
  const invoke = createDirectChatTransport(ports);
  return async (candidate, request, onDelta, cancellation) => {
    const {
      response,
      candidate: fixed,
      clientModelAlias,
      timeout,
      signal,
    } = await invoke(candidate, request, 'function', cancellation);
    try {
      return await consumeDirectOpenAIFunctionResponse(
        response,
        { upstreamModelId: fixed.upstreamModelId, clientModelAlias },
        onDelta,
        signal,
      );
    } catch (error) {
      if (timeout.aborted) throw new DirectProviderFailure('timeout', true, true);
      if (error instanceof DirectProviderFailure) throw error;
      throw new DirectProviderFailure('other', true, true);
    }
  };
}
