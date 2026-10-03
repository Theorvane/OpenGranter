import { type ReasoningDetail, snapshotReasoningDetails } from '../providers/reasoning-details.ts';

export interface ChatFunctionCall {
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
      readonly reasoning_details?: never;
    }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly name?: string;
      readonly tool_calls?: readonly ChatFunctionCall[];
      readonly tool_call_id?: never;
      readonly reasoning?: string | null;
      readonly reasoning_details?: readonly ReasoningDetail[];
    }
  | {
      readonly role: 'tool';
      readonly content: string;
      readonly tool_call_id: string;
      readonly name?: never;
      readonly tool_calls?: never;
      readonly reasoning?: never;
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
  if (!Array.isArray(value) || value.length > 128) throw new TypeError('Invalid chat messages');
  const ids = new Set<string>();
  const calls: ChatFunctionCall[] = [];
  for (const item of value) {
    const call = record(item);
    const operation = record(call?.function);
    if (
      !call ||
      !exact(call, ['id', 'type', 'function']) ||
      typeof call.id !== 'string' ||
      !call.id ||
      ids.has(call.id) ||
      call.type !== 'function' ||
      !operation ||
      !exact(operation, ['name', 'arguments']) ||
      typeof operation.name !== 'string' ||
      !operation.name ||
      typeof operation.arguments !== 'string'
    )
      throw new TypeError('Invalid chat messages');
    ids.add(call.id);
    calls.push(
      Object.freeze({
        id: call.id,
        type: 'function',
        function: Object.freeze({ name: operation.name, arguments: operation.arguments }),
      }),
    );
  }
  return Object.freeze(calls);
}

/** Capture a complete portable text/function history before asynchronous routing. */
export function snapshotChatMessages(value: unknown): readonly ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('Invalid chat messages');
  const messages: ChatMessage[] = [];
  let conversationSeen = false;
  const pending = new Set<string>();
  for (const raw of value) {
    const item = record(raw);
    if (!item || typeof item.role !== 'string') throw new TypeError('Invalid chat messages');
    const { role, content, name } = item;
    if (role === 'tool') {
      if (
        !exact(item, ['role', 'content', 'tool_call_id']) ||
        typeof content !== 'string' ||
        typeof item.tool_call_id !== 'string' ||
        !pending.delete(item.tool_call_id)
      )
        throw new TypeError('Invalid chat messages');
      messages.push(Object.freeze({ role, content, tool_call_id: item.tool_call_id }));
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
    if (
      role === 'assistant' &&
      Object.hasOwn(item, 'tool_calls') &&
      item.tool_calls !== undefined
    ) {
      if (!exact(item, ['role', 'content', 'name', 'tool_calls', 'reasoning', 'reasoning_details']))
        throw new TypeError('Invalid chat messages');
      const calls = snapshotCalls(item.tool_calls);
      if (
        (calls.length === 0 && typeof content !== 'string') ||
        (content !== null && content !== undefined && typeof content !== 'string')
      )
        throw new TypeError('Invalid chat messages');
      for (const call of calls) pending.add(call.id);
      messages.push(
        Object.freeze({
          role,
          content: content === undefined ? null : content,
          ...(name === undefined ? {} : { name }),
          tool_calls: calls,
          ...reasoningContent,
          ...detailContent,
        }),
      );
      continue;
    }
    const reasoningOnly =
      role === 'assistant' &&
      (content === null || content === undefined) &&
      ((typeof reasoning === 'string' && reasoning.length > 0) ||
        details?.some((detail) => {
          const payload =
            detail.type === 'reasoning.summary'
              ? detail.summary
              : detail.type === 'reasoning.encrypted'
                ? detail.data
                : detail.text;
          return typeof payload === 'string' && payload.length > 0;
        }) === true);
    if (
      !exact(item, [
        'role',
        'content',
        'name',
        ...(role === 'assistant' ? ['reasoning', 'reasoning_details'] : []),
      ]) ||
      (typeof content !== 'string' && !reasoningOnly)
    )
      throw new TypeError('Invalid chat messages');
    if (role === 'assistant') {
      messages.push(
        Object.freeze({
          role,
          content: content === undefined ? null : (content as string | null),
          ...(name === undefined ? {} : { name }),
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
