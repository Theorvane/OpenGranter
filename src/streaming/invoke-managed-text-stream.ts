import type { ChatRequest } from '../gateway/chat-handler.ts';
import { snapshotChatUsage } from '../providers/chat-usage.ts';
import type { createDirectOpenAITextStreamInvoker } from '../providers/direct-openai-stream.ts';
import {
  DirectProviderFailure,
  invokeManagedRoute,
  type JevManagedRouteInput,
  type JevManagedRoutePorts,
  type JevManagedRouteResult,
} from '../routing/invoke-jev-managed-route.ts';
import type { DirectOpenAITextStreamCompletion } from './direct-openai-text-response.ts';
import type { StreamChunkIdentity } from './invoke-delegated-text-stream.ts';
import { encodeOpenRouterTextSse } from './openrouter-client-sse.ts';

type Complete = DirectOpenAITextStreamCompletion;
export interface ManagedTextStreamInput extends Omit<JevManagedRouteInput<Complete>, 'ports'> {
  readonly request: ChatRequest;
  readonly signal?: AbortSignal;
  readonly onFrame: (frame: string, identity: StreamChunkIdentity) => void | Promise<void>;
  readonly ports: Omit<JevManagedRoutePorts<Complete>, 'invokeDirect'> & {
    readonly invokeDirectTextStream: ReturnType<typeof createDirectOpenAITextStreamInvoker>;
  };
}
export type ManagedTextStreamResult =
  | Exclude<JevManagedRouteResult<Complete>, { status: 'invoked' }>
  | (Extract<JevManagedRouteResult<Complete>, { status: 'invoked' }> & {
      readonly finalFrames: readonly string[];
    });

/** Retain managed routing controls; final usage and DONE await required handoffs. */
export async function invokeManagedTextStream(
  input: ManagedTextStreamInput,
): Promise<ManagedTextStreamResult> {
  if (!input.ports.writeUsage)
    return { status: 'failed', reason: 'usage-unavailable', possiblyBilled: false };
  const state: {
    terminal?: StreamChunkIdentity & { readonly finishReason: Complete['finishReason'] };
  } = {};
  const getTerminal = () => state.terminal;
  const { invokeDirectTextStream, ...ports } = input.ports;
  const result = await invokeManagedRoute({
    ...input,
    ports: {
      ...ports,
      invokeDirect: async (candidate) => {
        let emitted = false;
        let identity: StreamChunkIdentity | undefined;
        delete state.terminal;
        try {
          if (input.signal?.aborted) throw new DirectProviderFailure('other', false, false);
          const complete = await invokeDirectTextStream(
            candidate,
            input.request,
            async (delta) => {
              emitted = true;
              if (
                input.signal?.aborted ||
                state.terminal ||
                delta.model !== input.modelAlias ||
                (identity &&
                  (identity.id !== delta.id ||
                    identity.created !== delta.created ||
                    identity.model !== delta.model))
              )
                throw new DirectProviderFailure('other', true, true);
              identity ??= Object.freeze({
                id: delta.id,
                created: delta.created,
                model: delta.model,
              });
              const frame = encodeOpenRouterTextSse(delta);
              if (frame === undefined) throw new DirectProviderFailure('other', true, true);
              if (delta.finishReason !== null)
                state.terminal = { ...identity, finishReason: delta.finishReason };
              await input.onFrame(frame, identity);
            },
            input.signal,
          );
          const terminal = getTerminal();
          if (
            input.signal?.aborted ||
            !terminal ||
            terminal.id !== complete.id ||
            terminal.model !== complete.model ||
            terminal.finishReason !== complete.finishReason
          )
            throw new DirectProviderFailure('other', true, true);
          return {
            status: 'complete' as const,
            id: complete.id,
            model: complete.model,
            finishReason: complete.finishReason,
            usage: snapshotChatUsage(complete.usage),
            ...(complete.serviceTier === undefined ? {} : { serviceTier: complete.serviceTier }),
            ...(complete.systemFingerprint === undefined
              ? {}
              : { systemFingerprint: complete.systemFingerprint }),
          };
        } catch (error) {
          if (emitted || input.signal?.aborted)
            throw new DirectProviderFailure(
              'other',
              emitted,
              emitted || (error instanceof DirectProviderFailure && error.possiblyBilled),
            );
          throw error;
        }
      },
    },
  });
  if (result.status !== 'invoked') return result;
  if (!state.terminal) throw new DirectProviderFailure('other', true, true);
  const usage = encodeOpenRouterTextSse({
    kind: 'usage',
    ...state.terminal,
    usage: result.response.usage,
    ...(result.response.serviceTier === undefined
      ? {}
      : { serviceTier: result.response.serviceTier }),
    ...(result.response.systemFingerprint === undefined
      ? {}
      : { systemFingerprint: result.response.systemFingerprint }),
  });
  return {
    ...result,
    finalFrames: Object.freeze([...(usage === undefined ? [] : [usage]), 'data: [DONE]\n\n']),
  };
}
