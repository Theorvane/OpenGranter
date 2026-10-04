import { snapshotBoundedJsonObject } from '../gateway/chat-tools.ts';
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
/** Native Messages custom function consumer. Private call assembly is bounded and discarded on failure. */
export async function consumeDirectAnthropicFunctionResponse(
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
      !fixed.upstreamModelId ||
      !fixed.clientModelAlias ||
      !Number.isSafeInteger(created) ||
      created < 0
    )
      throw Error();
    let phase: 'start' | 'blocks' | 'usage' | 'terminal' = 'start',
      id: string | undefined,
      active: number | undefined,
      nextIndex = 0,
      toolIndex = 0;
    let activeType: 'text' | 'tool_use' | undefined,
      argumentsText = '',
      hasArgumentDelta = false;
    let input: unknown,
      output: unknown,
      previousOutput: number | undefined,
      finish: Delta['finishReason'] = null;
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
        if (message.usage !== undefined && message.usage !== null)
          input = record(message.usage).input_tokens;
        phase = 'blocks';
        await emit({ role: 'assistant', finishReason: null });
        continue;
      }
      if (!id) throw Error();
      if (event.type === 'content_block_start') {
        keys(event, ['type', 'index', 'content_block']);
        const block = record(event.content_block);
        keys(block, block.type === 'tool_use' ? ['type', 'id', 'name', 'input'] : ['type', 'text']);
        if (
          phase !== 'blocks' ||
          active !== undefined ||
          nextIndex >= 128 ||
          event.index !== nextIndex ||
          (block.type !== 'text' && block.type !== 'tool_use')
        )
          throw Error();
        active = nextIndex;
        activeType = block.type;
        if (block.type === 'text') {
          if (block.text !== '') throw Error();
        } else {
          if (
            typeof block.id !== 'string' ||
            !block.id ||
            typeof block.name !== 'string' ||
            !/^[A-Za-z0-9_-]{1,128}$/u.test(block.name) ||
            Object.keys(snapshotBoundedJsonObject(block.input)).length !== 0
          )
            throw Error();
          argumentsText = '';
          hasArgumentDelta = false;
          await emit({
            finishReason: null,
            toolCalls: [
              { index: toolIndex, id: block.id, type: 'function', function: { name: block.name } },
            ],
          });
        }
        continue;
      }
      if (event.type === 'content_block_delta') {
        keys(event, ['type', 'index', 'delta']);
        const delta = record(event.delta);
        keys(delta, activeType === 'tool_use' ? ['type', 'partial_json'] : ['type', 'text']);
        if (phase !== 'blocks' || active === undefined || event.index !== active) throw Error();
        if (activeType === 'tool_use') {
          if (delta.type !== 'input_json_delta' || typeof delta.partial_json !== 'string')
            throw Error();
          await emit({
            finishReason: null,
            toolCalls: [{ index: toolIndex, function: { arguments: delta.partial_json } }],
          });
          argumentsText += delta.partial_json;
          hasArgumentDelta = true;
        } else {
          if (delta.type !== 'text_delta' || typeof delta.text !== 'string') throw Error();
          await emit({ content: delta.text, finishReason: null });
        }
        continue;
      }
      if (event.type === 'content_block_stop') {
        keys(event, ['type', 'index']);
        if (phase !== 'blocks' || active === undefined || event.index !== active) throw Error();
        if (activeType === 'tool_use') {
          if (!hasArgumentDelta) {
            argumentsText = '{}';
            await emit({
              finishReason: null,
              toolCalls: [{ index: toolIndex, function: { arguments: argumentsText } }],
            });
          }
          snapshotBoundedJsonObject(JSON.parse(argumentsText) as unknown);
          argumentsText = '';
          toolIndex++;
        }
        active = undefined;
        activeType = undefined;
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
          reason !== 'refusal' &&
          reason !== 'tool_use'
        )
          throw Error();
        if (
          delta.stop_sequence !== null &&
          (reason !== 'stop_sequence' || typeof delta.stop_sequence !== 'string')
        )
          throw Error();
        const usage = event.usage == null ? undefined : record(event.usage);
        if (usage && Object.hasOwn(usage, 'input_tokens')) input = usage.input_tokens;
        output = usage?.output_tokens;
        if (typeof output === 'number' && Number.isSafeInteger(output) && output >= 0) {
          if (previousOutput !== undefined && output < previousOutput) throw Error();
          previousOutput = output;
        }
        if (reason === null) {
          phase = 'usage';
          continue;
        }
        finish =
          reason === 'tool_use'
            ? 'tool_calls'
            : reason === 'max_tokens'
              ? 'length'
              : reason === 'refusal'
                ? 'content_filter'
                : 'stop';
        phase = 'terminal';
        await emit({ finishReason: finish });
        continue;
      }
      if (event.type === 'message_stop') {
        keys(event, ['type']);
        if (phase !== 'terminal' || finish === null) throw Error();
        sequence.accept({
          kind: 'usage',
          id,
          created,
          model: fixed.clientModelAlias,
          finishReason: null,
          usage: normalizeProviderUsage({ input_tokens: input, output_tokens: output }, [
            'input_tokens',
            'output_tokens',
          ]),
        });
        sequence.accept({ kind: 'done' });
        const result = sequence.finish();
        if (result.status !== 'complete') throw Error();
        return result;
      }
      throw Error();
    }
    throw Error();
  } catch {
    sequence.discard();
    return fail(response);
  }
}
