import {
  type GoogleThoughtSignatureContent,
  MAX_GOOGLE_SIGNATURE_UNITS,
  snapshotGoogleThoughtSignature,
} from '../providers/google-thought-signature.ts';
import { type ReasoningDetail, snapshotReasoningDetails } from '../providers/reasoning-details.ts';

export interface ChatFunctionCall {
  readonly extra_content?: GoogleThoughtSignatureContent;
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export type ChatMessage =
  | {
      readonly role: 'system' | 'developer' | 'user';
      readonly content: string;
      readonly name?: string;
      readonly tool_calls?: never;
      readonly tool_call_id?: never;
      readonly reasoning?: never;
      readonly refusal?: never;
      readonly reasoning_details?: never;
    }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly name?: string;
      readonly tool_calls?: readonly ChatFunctionCall[];
      readonly tool_call_id?: never;
      readonly reasoning?: string | null;
      readonly refusal?: string | null;
      readonly reasoning_details?: readonly ReasoningDetail[];
    }
  | {
      readonly role: 'tool';
      readonly content: string;
      readonly tool_call_id: string;
      readonly name?: never;
      readonly tool_calls?: never;
      readonly reasoning?: never;
      readonly refusal?: never;
      readonly reasoning_details?: never;
    };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exact(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function snapshotCalls(value: unknown): readonly ChatFunctionCall[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid chat messages');
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > 128)
    throw new TypeError('Invalid chat messages');
  const ids = new Set<string>();
  const calls: ChatFunctionCall[] = [];
  let signatureUnits = 0;
  const source: readonly unknown[] = value;
  const entries = Array.from({ length }, (_, index) => source[index]);
  for (const item of entries) {
    const call = record(item);
    if (!call) throw new TypeError('Invalid chat messages');
    const { id, type, function: rawOperation } = call;
    const operation = record(rawOperation);
    if (!operation) throw new TypeError('Invalid chat messages');
    const { name, arguments: argumentsValue } = operation;
    if (
      !exact(call, ['id', 'type', 'function', 'extra_content']) ||
      typeof id !== 'string' ||
      !id ||
      ids.has(id) ||
      type !== 'function' ||
      !exact(operation, ['name', 'arguments']) ||
      typeof name !== 'string' ||
      !name ||
      typeof argumentsValue !== 'string'
    )
      throw new TypeError('Invalid chat messages');
    const extra = Object.hasOwn(call, 'extra_content')
      ? snapshotGoogleThoughtSignature(call.extra_content)
      : undefined;
    signatureUnits += extra?.google.thought_signature.length ?? 0;
    if (signatureUnits > MAX_GOOGLE_SIGNATURE_UNITS) throw new TypeError('Invalid chat messages');
    ids.add(id);
    calls.push(
      Object.freeze({
        id,
        type: 'function',
        ...(extra === undefined ? {} : { extra_content: extra }),
        function: Object.freeze({ name, arguments: argumentsValue }),
      }),
    );
  }
  return Object.freeze(calls);
}

/** Capture a complete portable text/function history before asynchronous routing. */
export function snapshotChatMessages(value: unknown): readonly ChatMessage[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid chat messages');
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 1) throw new TypeError('Invalid chat messages');
  const messages: ChatMessage[] = [];
  let conversationSeen = false;
  const pending = new Set<string>();
  const source: readonly unknown[] = value;
  const entries = Array.from({ length }, (_, index) => source[index]);
  for (const raw of entries) {
    const item = record(raw);
    if (!item) throw new TypeError('Invalid chat messages');
    const role = item.role;
    if (typeof role !== 'string') throw new TypeError('Invalid chat messages');
    const { content, name } = item;
    if (role === 'tool') {
      const toolCallId = item.tool_call_id;
      if (
        !exact(item, ['role', 'content', 'tool_call_id']) ||
        typeof content !== 'string' ||
        typeof toolCallId !== 'string' ||
        !pending.delete(toolCallId)
      )
        throw new TypeError('Invalid chat messages');
      messages.push(Object.freeze({ role, content, tool_call_id: toolCallId }));
      continue;
    }
    if (pending.size > 0) throw new TypeError('Invalid chat messages');
    if (role !== 'system' && role !== 'developer' && role !== 'user' && role !== 'assistant')
      throw new TypeError('Invalid chat messages');
    const instruction = role === 'system' || role === 'developer';
    if (instruction && conversationSeen) throw new TypeError('Invalid chat messages');
    if (!instruction) conversationSeen = true;
    if (name !== undefined && typeof name !== 'string')
      throw new TypeError('Invalid chat messages');
    const hasRefusal = Object.hasOwn(item, 'refusal');
    const refusal = hasRefusal ? item.refusal : undefined;
    if (hasRefusal && (role !== 'assistant' || (refusal !== null && typeof refusal !== 'string')))
      throw new TypeError('Invalid chat messages');
    const refusalContent = hasRefusal ? { refusal: refusal as string | null } : {};
    const hasReasoning = Object.hasOwn(item, 'reasoning');
    const reasoning = hasReasoning ? item.reasoning : undefined;
    if (
      hasReasoning &&
      (role !== 'assistant' || (reasoning !== null && typeof reasoning !== 'string'))
    )
      throw new TypeError('Invalid chat messages');
    const reasoningContent = hasReasoning ? { reasoning: reasoning as string | null } : {};
    const hasDetails = Object.hasOwn(item, 'reasoning_details');
    const details = hasDetails ? snapshotReasoningDetails(item.reasoning_details) : undefined;
    if (hasDetails && (role !== 'assistant' || details === undefined))
      throw new TypeError('Invalid chat messages');
    const detailContent = details === undefined ? {} : { reasoning_details: details };
    if (role === 'assistant' && Object.hasOwn(item, 'tool_calls')) {
      const toolCalls = item.tool_calls;
      if (
        !exact(item, [
          'role',
          'content',
          'name',
          'tool_calls',
          'reasoning',
          'reasoning_details',
          'refusal',
        ])
      )
        throw new TypeError('Invalid chat messages');
      const calls = snapshotCalls(toolCalls);
      if (content !== null && content !== undefined && typeof content !== 'string')
        throw new TypeError('Invalid chat messages');
      for (const call of calls) pending.add(call.id);
      messages.push(
        Object.freeze({
          role,
          content: content === undefined ? null : content,
          ...(name === undefined ? {} : { name }),
          tool_calls: calls,
          ...refusalContent,
          ...reasoningContent,
          ...detailContent,
        }),
      );
      continue;
    }
    const noTextAssistant = role === 'assistant' && (content === null || content === undefined);
    if (
      !exact(item, [
        'role',
        'content',
        'name',
        ...(role === 'assistant' ? ['reasoning', 'reasoning_details', 'refusal'] : []),
      ]) ||
      (typeof content !== 'string' && !noTextAssistant)
    )
      throw new TypeError('Invalid chat messages');
    if (role === 'assistant') {
      messages.push(
        Object.freeze({
          role,
          content: content === undefined ? null : (content as string | null),
          ...(name === undefined ? {} : { name }),
          ...refusalContent,
          ...reasoningContent,
          ...detailContent,
        }),
      );
    } else {
      messages.push(
        Object.freeze({
          role,
          content: content as string,
          ...(name === undefined ? {} : { name }),
        }),
      );
    }
  }
  if (pending.size > 0) throw new TypeError('Invalid chat messages');
  return Object.freeze(messages);
}
