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
import { encodeOpenRouterTextSse } from './openrouter-client-sse.ts';
import type { OpenRouterTextStreamPayload } from './openrouter-stream-chunks.ts';
import type { OpenRouterTextStreamOutcome } from './openrouter-stream-sequence.ts';

type Delta = Extract<OpenRouterTextStreamPayload, { kind: 'delta' }>;
type Complete = Extract<OpenRouterTextStreamOutcome, { status: 'complete' }>;
type Summary = Omit<Complete, 'usageLogprobs'>;
export type StreamChunkIdentity = Readonly<Pick<Delta, 'id' | 'created' | 'model'>>;
type Terminal = Pick<Delta, 'id' | 'model' | 'created'> & {
  readonly finishReason: NonNullable<Delta['finishReason']>;
};

export interface DelegatedTextStreamInput extends Omit<DelegatedRouteInput<Summary>, 'ports'> {
  readonly onFrame: (frame: string, identity: StreamChunkIdentity) => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly ports: Omit<DelegatedRoutePorts<Summary>, 'invokeOpenRouter'> & {
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
  | Exclude<DelegatedRouteResult<Summary>, { status: 'invoked' }>
  | {
      readonly status: 'invoked';
      readonly response: Summary;
      readonly finalFrames: readonly string[];
    };

/** Compose delegated controls with scoped text delivery; final frames await usage and audit. */
export async function invokeDelegatedTextStream(
  input: DelegatedTextStreamInput,
): Promise<DelegatedTextStreamResult> {
  let terminal: Terminal | undefined;
  let usageLogprobs: ChatLogprobs | null | undefined;
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
                  const frame = encodeOpenRouterTextSse(delta);
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
  const usageFrame = encodeOpenRouterTextSse({
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
      encodeOpenRouterTextSse({ kind: 'done' }) ?? 'data: [DONE]\n\n',
    ]),
  };
}
