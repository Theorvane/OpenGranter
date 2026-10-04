import { normalizeGoogleChatUsage } from '../providers/google-chat-usage.ts';
import {
  DirectProviderFailure,
  type DirectProviderFailureCategory,
} from '../routing/invoke-jev-managed-route.ts';
import type {
  DirectOpenAITextStreamCompletion,
  DirectOpenAITextStreamPayload,
} from './direct-openai-text-response.ts';
import type { StreamModelScope } from './openrouter-stream-chunks.ts';
import { parseSseDataEvents } from './parse-sse-data-events.ts';
import { waitForStreamOperation } from './wait-for-stream-operation.ts';

type Delta = Extract<DirectOpenAITextStreamPayload, { kind: 'delta' }>;
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
/** Consume the bounded native GenerateContent text subset through clean framed EOF. */
export async function consumeDirectGoogleTextResponse(
  response: Response,
  scope: StreamModelScope,
  onDelta: (delta: Delta) => void | Promise<void>,
  signal?: AbortSignal,
  created = Math.floor(Date.now() / 1000),
): Promise<DirectOpenAITextStreamCompletion> {
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
      usage: DirectOpenAITextStreamCompletion['usage'];
    const emit = async (fields: Pick<Delta, 'content' | 'role' | 'finishReason'>) => {
      if (!id) throw Error();
      await waitForStreamOperation(
        Promise.resolve(
          onDelta(
            Object.freeze({ kind: 'delta', id, created, model: fixed.clientModelAlias, ...fields }),
          ),
        ),
        signal,
      );
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
        usage = normalizeGoogleChatUsage(value.usageMetadata);
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
        const texts = parts.map((part) => {
          const p = record(part);
          keys(p, ['text', 'thought']);
          if (typeof p.text !== 'string' || (p.thought !== undefined && p.thought !== false))
            throw Error();
          return p.text;
        });
        if (!roleSent) {
          await emit({ role: 'assistant', finishReason: null });
          roleSent = true;
        }
        for (const text of texts) await emit({ content: text, finishReason: null });
        if (reason === 'STOP' || reason === 'MAX_TOKENS' || reason === 'SAFETY')
          finish =
            reason === 'STOP' ? 'stop' : reason === 'MAX_TOKENS' ? 'length' : 'content_filter';
      }
      if (finish !== null) {
        usage = normalizeGoogleChatUsage(value.usageMetadata);
        await emit({ finishReason: finish });
      }
    }
    if (id === undefined || finish === null) throw Error();
    return Object.freeze({
      status: 'complete',
      id,
      model: fixed.clientModelAlias,
      finishReason: finish,
      usage: usage && Object.freeze(usage),
    });
  } catch {
    return fail(response);
  }
}
