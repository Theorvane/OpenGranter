import { normalizeGoogleFunctionResponse } from '../providers/google-client-functions.ts';
import {
  DirectProviderFailure,
  type DirectProviderFailureCategory,
} from '../routing/invoke-jev-managed-route.ts';
import { normalizeProviderUsage } from '../usage/normalize-provider-tokens.ts';
import type {
  DirectOpenAIFunctionStreamCompletion,
  DirectOpenAIFunctionStreamPayload,
} from './direct-openai-function-response.ts';
import { OpenRouterFunctionStreamSequence } from './openrouter-function-stream-sequence.ts';
import type { StreamModelScope } from './openrouter-stream-chunks.ts';
import { parseSseDataEvents } from './parse-sse-data-events.ts';
import { waitForStreamOperation } from './wait-for-stream-operation.ts';

type Delta = Extract<DirectOpenAIFunctionStreamPayload, { kind: 'delta' }>;
function record(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw Error();
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(v).some((k) => !allowed.includes(k))) throw Error();
}
function fail(response: Response, category: DirectProviderFailureCategory = 'other'): never {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {}
  throw new DirectProviderFailure(category, true, true);
}
/** Consume the bounded native GenerateContent complete custom function subset through clean framed EOF. */
export async function consumeDirectGoogleFunctionResponse(
  response: Response,
  scope: StreamModelScope,
  onDelta: (delta: Delta) => void | Promise<void>,
  signal?: AbortSignal,
  created = Math.floor(Date.now() / 1000),
): Promise<DirectOpenAIFunctionStreamCompletion> {
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
    return fail(response);
  const sequence = new OpenRouterFunctionStreamSequence();
  try {
    const fixed = Object.freeze({
      upstreamModelId: scope.upstreamModelId,
      clientModelAlias: scope.clientModelAlias,
    });
    if (
      typeof fixed.upstreamModelId !== 'string' ||
      !fixed.upstreamModelId ||
      typeof fixed.clientModelAlias !== 'string' ||
      !fixed.clientModelAlias ||
      !Number.isSafeInteger(created) ||
      created < 0
    )
      throw Error();
    let id: string | undefined,
      finish: Delta['finishReason'] = null,
      tail = false,
      roleSent = false,
      toolIndex = 0,
      usage: DirectOpenAIFunctionStreamCompletion['usage'];
    const ids = new Set<string>();
    const emit = async (fields: Pick<Delta, 'content' | 'role' | 'finishReason' | 'toolCalls'>) => {
      if (!id) throw Error();
      const event = Object.freeze({
        kind: 'delta' as const,
        id,
        created,
        model: fixed.clientModelAlias,
        ...fields,
      });
      sequence.accept(event);
      await waitForStreamOperation(Promise.resolve(onDelta(event)), signal);
    };
    for await (const data of parseSseDataEvents(response.body, undefined, signal, true)) {
      const value = record(JSON.parse(data) as unknown);
      if (Object.hasOwn(value, 'error')) throw Error();
      keys(value, [
        'candidates',
        'promptFeedback',
        'usageMetadata',
        'modelVersion',
        'responseId',
        'modelStatus',
      ]);
      if (id === undefined) {
        if (
          value.modelVersion !== fixed.upstreamModelId ||
          typeof value.responseId !== 'string' ||
          !value.responseId ||
          value.responseId.length > 256
        )
          throw Error();
        id = value.responseId;
      } else if (
        (Object.hasOwn(value, 'modelVersion') && value.modelVersion !== fixed.upstreamModelId) ||
        (Object.hasOwn(value, 'responseId') && value.responseId !== id)
      )
        throw Error();
      const candidates = value.candidates;
      if (finish !== null) {
        if (
          tail ||
          Object.hasOwn(value, 'promptFeedback') ||
          !Object.hasOwn(value, 'usageMetadata') ||
          (candidates !== undefined && (!Array.isArray(candidates) || candidates.length !== 0))
        )
          throw Error();
        usage = normalizeProviderUsage(
          value.usageMetadata,
          ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'],
          false,
        );
        tail = true;
        continue;
      }
      let blocked = false;
      if (value.promptFeedback !== undefined) {
        const feedback = record(value.promptFeedback);
        keys(feedback, ['blockReason', 'safetyRatings']);
        if (
          feedback.blockReason !== undefined &&
          feedback.blockReason !== '' &&
          feedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED'
        ) {
          if (
            feedback.blockReason !== 'SAFETY' ||
            (candidates !== undefined && (!Array.isArray(candidates) || candidates.length !== 0))
          )
            throw Error();
          blocked = true;
        }
      }
      if (blocked) {
        // Prompt filtering cannot appear after earlier generated content.
        if (value.responseId !== id || roleSent) throw Error();
        await emit({ role: 'assistant', finishReason: null });
        roleSent = true;
        finish = 'content_filter';
      } else {
        if (!Array.isArray(candidates) || candidates.length !== 1) throw Error();
        const candidate = record(candidates[0]);
        keys(candidate, [
          'index',
          'content',
          'finishReason',
          'safetyRatings',
          'citationMetadata',
          'tokenCount',
          'avgLogprobs',
          'logprobsResult',
          'finishMessage',
        ]);
        if (candidate.index !== undefined && candidate.index !== 0) throw Error();
        const reason = candidate.finishReason;
        if (
          reason !== undefined &&
          reason !== '' &&
          reason !== 'FINISH_REASON_UNSPECIFIED' &&
          reason !== 'STOP' &&
          reason !== 'MAX_TOKENS' &&
          reason !== 'SAFETY'
        )
          throw Error();
        let parts: unknown[] = [];
        if (candidate.content !== undefined) {
          const content = record(candidate.content);
          keys(content, ['role', 'parts']);
          if (content.role !== undefined && content.role !== 'model') throw Error();
          if (content.parts !== undefined) {
            if (!Array.isArray(content.parts) || content.parts.length > 128) throw Error();
            parts = content.parts;
          }
        }
        if (reason === 'SAFETY' && parts.length !== 0) throw Error();
        const hasCalls = parts.some((p) => Object.hasOwn(record(p), 'functionCall'));
        const assistant = hasCalls ? normalizeGoogleFunctionResponse(parts, true) : undefined;
        if (hasCalls && !assistant) throw Error();
        const calls = assistant?.tool_calls ?? [];
        if (toolIndex + calls.length > 128) throw Error();
        for (const call of calls) {
          if (ids.has(call.id)) throw Error();
          ids.add(call.id);
        }
        // Validate every native part before emitting role, text or calls from this event.
        for (const part of parts) {
          const p = record(part);
          if (!hasCalls) {
            keys(p, ['text', 'thought']);
            if (typeof p.text !== 'string' || (p.thought !== undefined && p.thought !== false))
              throw Error();
          }
        }
        if ((toolIndex || calls.length) && (reason === 'MAX_TOKENS' || reason === 'SAFETY'))
          throw Error();
        if (!roleSent) {
          await emit({ role: 'assistant', finishReason: null });
          roleSent = true;
        }
        let callOffset = 0;
        for (const part of parts) {
          const p = record(part);
          if (Object.hasOwn(p, 'functionCall')) {
            const call = calls[callOffset++];
            if (!call) throw Error();
            await emit({
              finishReason: null,
              toolCalls: [
                {
                  index: toolIndex++,
                  id: call.id,
                  type: 'function',
                  function: call.function,
                  ...(call.extra_content === undefined
                    ? {}
                    : { extra_content: call.extra_content }),
                },
              ],
            });
          } else await emit({ content: p.text as string, finishReason: null });
        }
        if (reason === 'STOP' || reason === 'MAX_TOKENS' || reason === 'SAFETY')
          finish =
            reason === 'STOP'
              ? toolIndex > 0
                ? 'tool_calls'
                : 'stop'
              : reason === 'MAX_TOKENS'
                ? 'length'
                : 'content_filter';
      }
      if (finish !== null) {
        usage = normalizeProviderUsage(
          value.usageMetadata,
          ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'],
          false,
        );
        await emit({ finishReason: finish });
      }
    }
    if (id === undefined || finish === null) throw Error();
    sequence.accept({
      kind: 'usage',
      id,
      created,
      model: fixed.clientModelAlias,
      finishReason: null,
      usage,
    });
    sequence.accept({ kind: 'done' });
    const result = sequence.finish();
    if (result.status !== 'complete') throw Error();
    return result;
  } catch {
    sequence.discard();
    return fail(response);
  }
}
