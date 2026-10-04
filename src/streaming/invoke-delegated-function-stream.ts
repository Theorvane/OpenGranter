import type { ChatRequest } from '../gateway/chat-handler.ts';
import { type ChatLogprobs, snapshotChatLogprobs } from '../providers/chat-logprobs.ts';
import { snapshotChatUsage } from '../providers/chat-usage.ts';
import { type OpenRouterChatAttempt, OpenRouterChatFailure } from '../providers/openrouter-chat.ts';
import {
  type DelegatedRouteInput,
  type DelegatedRoutePorts,
  type DelegatedRouteResult,
  invokeDelegatedRoute,
} from '../routing/invoke-delegated-route.ts';
import { encodeOpenRouterFunctionSse } from './openrouter-client-sse.ts';
import type { OpenRouterFunctionStreamOutcome } from './openrouter-function-stream-sequence.ts';
import type { OpenRouterFunctionStreamPayload } from './openrouter-stream-chunks.ts';

type Delta = Extract<OpenRouterFunctionStreamPayload, { kind: 'delta' }>;
type Complete = Extract<OpenRouterFunctionStreamOutcome, { status: 'complete' }>;
/** Response calls never enter the routing/accounting result. */
type Summary = Omit<Complete, 'toolCalls' | 'usageLogprobs'>;
export type FunctionStreamChunkIdentity = Readonly<Pick<Delta, 'id' | 'created' | 'model'>>;
type Terminal = Pick<Delta, 'id' | 'model' | 'created'> & {
  readonly finishReason: NonNullable<Delta['finishReason']>;
};

export interface DelegatedFunctionStreamInput extends Omit<DelegatedRouteInput<Summary>, 'ports'> {
  readonly onFrame: (frame: string, identity: FunctionStreamChunkIdentity) => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly ports: Omit<DelegatedRoutePorts<Summary>, 'invokeOpenRouter'> & {
    readonly invokeOpenRouterFunctionStream?: (
      credentialRef: string,
      attempt: OpenRouterChatAttempt,
      request: ChatRequest,
      onDelta: (delta: Delta) => void | Promise<void>,
      signal?: AbortSignal,
    ) => Promise<Complete>;
  };
}

export type DelegatedFunctionStreamResult =
  | Exclude<DelegatedRouteResult<Summary>, { status: 'invoked' }>
  | {
      readonly status: 'invoked';
      readonly response: Summary;
      readonly finalFrames: readonly string[];
    };

/** Compose delegated controls with scoped function delivery; final frames await usage and audit. */
export async function invokeDelegatedFunctionStream(
  input: DelegatedFunctionStreamInput,
): Promise<DelegatedFunctionStreamResult> {
  let terminal: Terminal | undefined;
  let usageLogprobs: ChatLogprobs | null | undefined;
  const { invokeOpenRouterFunctionStream: invoker, ...routePorts } = input.ports;
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
            ): Promise<Summary> => {
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
                  const frame = encodeOpenRouterFunctionSse(delta);
                  if (frame === undefined) throw new OpenRouterChatFailure('upstream', true, true);
                  await input.onFrame(
                    frame,
                    Object.freeze({ id: delta.id, created: delta.created, model: delta.model }),
                  );
                },
                input.signal,
              );
              const {
                id,
                model,
                finishReason,
                usage,
                serviceTier,
                systemFingerprint,
                nativeFinishReason,
              } = complete;
              if (
                terminal === undefined ||
                terminal.id !== id ||
                terminal.model !== model ||
                terminal.finishReason !== finishReason
              )
                throw new OpenRouterChatFailure('upstream', true, true);
              usageLogprobs = snapshotChatLogprobs(complete.usageLogprobs);
              return {
                status: 'complete',
                id,
                model,
                finishReason,
                usage: snapshotChatUsage(usage),
                ...(serviceTier === undefined ? {} : { serviceTier }),
                ...(systemFingerprint === undefined ? {} : { systemFingerprint }),
                ...(nativeFinishReason === undefined ? {} : { nativeFinishReason }),
              };
            },
          }
        : {}),
    },
  });
  if (result.status !== 'invoked') return result;
  if (terminal === undefined) throw new OpenRouterChatFailure('upstream', true, true);
  const serviceTier = result.response.serviceTier;
  const usageFrame = encodeOpenRouterFunctionSse({
    kind: 'usage',
    id: terminal.id,
    model: terminal.model,
    created: terminal.created,
    finishReason: terminal.finishReason,
    usage: result.response.usage,
    ...(usageLogprobs === undefined ? {} : { logprobs: usageLogprobs }),
    ...(result.response.nativeFinishReason === undefined
      ? {}
      : { nativeFinishReason: result.response.nativeFinishReason }),
    ...(result.response.systemFingerprint === undefined
      ? {}
      : { systemFingerprint: result.response.systemFingerprint }),
    ...(serviceTier === undefined ? {} : { serviceTier }),
  });
  return {
    ...result,
    finalFrames: Object.freeze([
      ...(usageFrame === undefined ? [] : [usageFrame]),
      encodeOpenRouterFunctionSse({ kind: 'done' }) ?? 'data: [DONE]\n\n',
    ]),
  };
}
