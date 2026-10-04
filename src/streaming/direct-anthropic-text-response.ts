import { AnthropicStreamUsage } from '../providers/anthropic-chat-usage.ts';
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
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((k) => !allowed.includes(k))) throw Error();
}
function fail(response: Response, category: DirectProviderFailureCategory = 'other'): never {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {}
  throw new DirectProviderFailure(category, true, true);
}
/** Internal text-only Messages consumer. No response content is retained in its summary. */
export async function consumeDirectAnthropicTextResponse(
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
      !fixed.upstreamModelId ||
      !fixed.clientModelAlias ||
      !Number.isSafeInteger(created) ||
      created < 0
    )
      throw Error();
    let phase: 'start' | 'blocks' | 'usage' | 'terminal' = 'start',
      id: string | undefined,
      active: number | undefined,
      nextIndex = 0;
    let capturedUsage = new AnthropicStreamUsage(undefined);
    let output: unknown,
      previousOutput: number | undefined,
      finish: Delta['finishReason'] = null;
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
    for await (const data of parseSseDataEvents(response.body, undefined, signal)) {
      const event = record(JSON.parse(data) as unknown);
      if (event.type === 'ping') {
        keys(event, ['type']);
        continue;
      }
      if (event.type === 'error') throw Error();
      if (event.type === 'message_start') {
        keys(event, ['type', 'message']);
        if (phase !== 'start') throw Error();
        const message = record(event.message);
        if (
          message.type !== 'message' ||
          message.role !== 'assistant' ||
          message.model !== fixed.upstreamModelId ||
          typeof message.id !== 'string' ||
          !message.id ||
          message.id.length > 256 ||
          !Array.isArray(message.content) ||
          message.content.length !== 0 ||
          message.stop_reason !== null ||
          message.stop_sequence !== null ||
          Object.hasOwn(message, 'input_transformations')
        )
          throw Error();
        id = message.id;
        capturedUsage = new AnthropicStreamUsage(
          message.usage == null ? undefined : record(message.usage),
        );
        phase = 'blocks';
        await emit({ role: 'assistant', finishReason: null });
        continue;
      }
      if (!id) throw Error();
      if (event.type === 'content_block_start') {
        keys(event, ['type', 'index', 'content_block']);
        const block = record(event.content_block);
        keys(block, ['type', 'text']);
        if (
          phase !== 'blocks' ||
          active !== undefined ||
          nextIndex >= 128 ||
          event.index !== nextIndex ||
          block.type !== 'text' ||
          block.text !== ''
        )
          throw Error();
        active = nextIndex;
        continue;
      }
      if (event.type === 'content_block_delta') {
        keys(event, ['type', 'index', 'delta']);
        const delta = record(event.delta);
        keys(delta, ['type', 'text']);
        if (
          phase !== 'blocks' ||
          active === undefined ||
          event.index !== active ||
          delta.type !== 'text_delta' ||
          typeof delta.text !== 'string'
        )
          throw Error();
        await emit({ content: delta.text, finishReason: null });
        continue;
      }
      if (event.type === 'content_block_stop') {
        keys(event, ['type', 'index']);
        if (phase !== 'blocks' || active === undefined || event.index !== active) throw Error();
        active = undefined;
        nextIndex++;
        continue;
      }
      if (event.type === 'message_delta') {
        keys(event, ['type', 'delta', 'usage']);
        const delta = record(event.delta);
        keys(delta, ['stop_reason', 'stop_sequence']);
        if (
          (phase !== 'blocks' && phase !== 'usage') ||
          active !== undefined ||
          !Object.hasOwn(event, 'usage')
        )
          throw Error();
        const reason = delta.stop_reason;
        if (
          reason !== null &&
          reason !== 'end_turn' &&
          reason !== 'stop_sequence' &&
          reason !== 'max_tokens' &&
          reason !== 'refusal'
        )
          throw Error();
        if (
          delta.stop_sequence !== null &&
          (reason !== 'stop_sequence' || typeof delta.stop_sequence !== 'string')
        )
          throw Error();
        const usage = event.usage == null ? undefined : record(event.usage);
        output = capturedUsage.update(usage);
        if (typeof output === 'number' && Number.isSafeInteger(output) && output >= 0) {
          if (previousOutput !== undefined && output < previousOutput) throw Error();
          previousOutput = output;
        }
        if (reason === null) {
          phase = 'usage';
          continue;
        }
        finish =
          reason === 'max_tokens' ? 'length' : reason === 'refusal' ? 'content_filter' : 'stop';
        phase = 'terminal';
        await emit({ finishReason: finish });
        continue;
      }
      if (event.type === 'message_stop') {
        keys(event, ['type']);
        if (phase !== 'terminal' || finish === null) throw Error();
        return Object.freeze({
          status: 'complete',
          id,
          model: fixed.clientModelAlias,
          finishReason: finish,
          usage: capturedUsage.finish(),
        });
      }
      throw Error();
    }
    throw Error();
  } catch {
    return fail(response);
  }
}
