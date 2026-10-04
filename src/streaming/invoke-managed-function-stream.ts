import type { ChatRequest } from '../gateway/chat-handler.ts';
import { type ChatLogprobs, snapshotChatLogprobs } from '../providers/chat-logprobs.ts';
import { snapshotChatUsage } from '../providers/chat-usage.ts';
import type { createDirectOpenAIFunctionStreamInvoker } from '../providers/direct-openai-function-stream.ts';
import {
  DirectProviderFailure,
  invokeManagedRoute,
  type JevManagedRouteInput,
  type JevManagedRoutePorts,
  type JevManagedRouteResult,
} from '../routing/invoke-jev-managed-route.ts';
import type { DirectOpenAIFunctionStreamCompletion } from './direct-openai-function-response.ts';
import type { StreamChunkIdentity } from './invoke-delegated-text-stream.ts';
import { encodeOpenRouterFunctionSse } from './openrouter-client-sse.ts';

type Complete = Omit<DirectOpenAIFunctionStreamCompletion, 'toolCalls' | 'usageLogprobs'>;
export interface ManagedFunctionStreamInput extends Omit<JevManagedRouteInput<Complete>, 'ports'> {
  readonly request: ChatRequest;
  readonly signal?: AbortSignal;
  readonly onFrame: (frame: string, identity: StreamChunkIdentity) => void | Promise<void>;
  readonly ports: Omit<JevManagedRoutePorts<Complete>, 'invokeDirect'> & {
    readonly invokeDirectFunctionStream: ReturnType<typeof createDirectOpenAIFunctionStreamInvoker>;
  };
}
export type ManagedFunctionStreamResult =
  | Exclude<JevManagedRouteResult<Complete>, { status: 'invoked' }>
  | (Extract<JevManagedRouteResult<Complete>, { status: 'invoked' }> & {
      readonly finalFrames: readonly string[];
    });

/** Retain managed routing controls; final usage and DONE await required handoffs. */
export async function invokeManagedFunctionStream(
  input: ManagedFunctionStreamInput,
): Promise<ManagedFunctionStreamResult> {
  if (!input.ports.writeUsage)
    return { status: 'failed', reason: 'usage-unavailable', possiblyBilled: false };
  const state: {
    terminal?: StreamChunkIdentity & { readonly finishReason: Complete['finishReason'] };
  } = {};
  let usageLogprobs: ChatLogprobs | null | undefined;
  const getTerminal = () => state.terminal;
  const { invokeDirectFunctionStream, ...ports } = input.ports;
  const result = await invokeManagedRoute({
    ...input,
    ports: {
      ...ports,
      invokeDirect: async (candidate) => {
        let emitted = false;
        let identity: StreamChunkIdentity | undefined;
        delete state.terminal;
        usageLogprobs = undefined;
        try {
          if (input.signal?.aborted) throw new DirectProviderFailure('other', false, false);
          const complete = await invokeDirectFunctionStream(
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
              const frame = encodeOpenRouterFunctionSse(delta);
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
          usageLogprobs = snapshotChatLogprobs(complete.usageLogprobs);
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
  const usage = encodeOpenRouterFunctionSse({
    kind: 'usage',
    ...state.terminal,
    usage: result.response.usage,
    ...(usageLogprobs === undefined ? {} : { logprobs: usageLogprobs }),
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
