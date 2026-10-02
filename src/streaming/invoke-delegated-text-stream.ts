import type { ChatRequest } from '../gateway/chat-handler.ts';
import { type OpenRouterChatAttempt, OpenRouterChatFailure } from '../providers/openrouter-chat.ts';
import {
  type DelegatedRouteInput,
  type DelegatedRoutePorts,
  type DelegatedRouteResult,
  invokeDelegatedRoute,
} from '../routing/invoke-delegated-route.ts';
import { encodeOpenRouterTextSse } from './openrouter-client-sse.ts';
import type { OpenRouterTextStreamPayload } from './openrouter-stream-chunks.ts';
import type { OpenRouterTextStreamOutcome } from './openrouter-stream-sequence.ts';

type Delta = Extract<OpenRouterTextStreamPayload, { kind: 'delta' }>;
type Complete = Extract<OpenRouterTextStreamOutcome, { status: 'complete' }>;
export type StreamChunkIdentity = Readonly<Pick<Delta, 'id' | 'created' | 'model'>>;
type Terminal = Pick<Delta, 'id' | 'model' | 'created'> & {
  readonly finishReason: NonNullable<Delta['finishReason']>;
};

export interface DelegatedTextStreamInput extends Omit<DelegatedRouteInput<Complete>, 'ports'> {
  readonly onFrame: (frame: string, identity: StreamChunkIdentity) => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly ports: Omit<DelegatedRoutePorts<Complete>, 'invokeOpenRouter'> & {
    readonly invokeOpenRouterTextStream?: (
      credentialRef: string,
      attempt: OpenRouterChatAttempt,
      request: ChatRequest,
      onDelta: (delta: Delta) => void | Promise<void>,
      signal?: AbortSignal,
    ) => Promise<Complete>;
  };
}

export type DelegatedTextStreamResult =
  | Exclude<DelegatedRouteResult<Complete>, { status: 'invoked' }>
  | {
      readonly status: 'invoked';
      readonly response: Complete;
      readonly finalFrames: readonly string[];
    };

/** Compose delegated controls with scoped text delivery; final frames await usage and audit. */
export async function invokeDelegatedTextStream(
  input: DelegatedTextStreamInput,
): Promise<DelegatedTextStreamResult> {
  let terminal: Terminal | undefined;
  const { invokeOpenRouterTextStream: invoker, ...routePorts } = input.ports;
  const result = await invokeDelegatedRoute({
    ...input,
    ports: {
      ...routePorts,
      ...(invoker
        ? {
            invokeOpenRouter: async (
              credentialRef: string,
              attempt: OpenRouterChatAttempt,
              request: ChatRequest,
            ): Promise<Complete> => {
              const complete = await invoker(
                credentialRef,
                attempt,
                request,
                async (delta) => {
                  if (delta.finishReason !== null) {
                    terminal = {
                      id: delta.id,
                      model: delta.model,
                      created: delta.created,
                      finishReason: delta.finishReason,
                    };
                  }
                  const frame = encodeOpenRouterTextSse(delta);
                  if (frame === undefined) throw new OpenRouterChatFailure('upstream', true, true);
                  await input.onFrame(
                    frame,
                    Object.freeze({ id: delta.id, created: delta.created, model: delta.model }),
                  );
                },
                input.signal,
              );
              if (
                terminal === undefined ||
                terminal.id !== complete.id ||
                terminal.model !== complete.model ||
                terminal.finishReason !== complete.finishReason
              )
                throw new OpenRouterChatFailure('upstream', true, true);
              return complete;
            },
          }
        : {}),
    },
  });
  if (result.status !== 'invoked') return result;
  if (terminal === undefined) throw new OpenRouterChatFailure('upstream', true, true);
  const usageFrame = encodeOpenRouterTextSse({
    kind: 'usage',
    id: terminal.id,
    model: terminal.model,
    created: terminal.created,
    finishReason: terminal.finishReason,
    usage: result.response.usage,
    ...(result.response.systemFingerprint === undefined
      ? {}
      : { systemFingerprint: result.response.systemFingerprint }),
  });
  return {
    ...result,
    finalFrames: Object.freeze([
      ...(usageFrame === undefined ? [] : [usageFrame]),
      encodeOpenRouterTextSse({ kind: 'done' }) ?? 'data: [DONE]\n\n',
    ]),
  };
}
