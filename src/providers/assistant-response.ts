import { type ReasoningDetail, snapshotReasoningDetails } from './reasoning-details.ts';

export interface AssistantFunctionCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

/** Narrow non-streaming assistant output; provider-specific errors remain at adapters. */
export interface AssistantResponse {
  readonly role: 'assistant';
  readonly content: string | null;
  readonly refusal?: string | null;
  readonly reasoning?: string | null;
  readonly reasoning_details?: readonly ReasoningDetail[];
  readonly tool_calls?: readonly AssistantFunctionCall[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function functionCalls(value: readonly unknown[]): readonly AssistantFunctionCall[] | undefined {
  if (value.length === 0 || value.length > 128) return undefined;
  const ids = new Set<string>();
  const calls: AssistantFunctionCall[] = [];
  for (const item of value) {
    const call = record(item);
    const operation = record(call?.function);
    if (
      typeof call?.id !== 'string' ||
      !call.id ||
      ids.has(call.id) ||
      call.type !== 'function' ||
      typeof operation?.name !== 'string' ||
      !operation.name ||
      typeof operation.arguments !== 'string'
    )
      return undefined;
    ids.add(call.id);
    calls.push({
      id: call.id,
      type: 'function',
      function: { name: operation.name, arguments: operation.arguments },
    });
  }
  return calls;
}

export function normalizeAssistantResponse(
  value: Record<string, unknown> | undefined,
  finish: unknown,
): AssistantResponse | undefined {
  if (value?.role !== 'assistant') return undefined;
  const hasReasoning = Object.hasOwn(value, 'reasoning');
  const reasoning = value.reasoning;
  if (hasReasoning && reasoning !== null && typeof reasoning !== 'string') return undefined;
  const reasoningContent =
    hasReasoning && (typeof reasoning === 'string' || reasoning === null) ? { reasoning } : {};
  const hasDetails = Object.hasOwn(value, 'reasoning_details');
  const details = hasDetails ? snapshotReasoningDetails(value.reasoning_details) : undefined;
  if (hasDetails && details === undefined) return undefined;
  const detailContent = details === undefined ? {} : { reasoning_details: details };
  const toolCalls = value.tool_calls;
  if (
    finish === 'function_call' ||
    (value.function_call !== undefined && value.function_call !== null)
  )
    return undefined;
  if (toolCalls !== undefined && toolCalls !== null && !Array.isArray(toolCalls)) return undefined;
  const hasCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
  if (hasCalls !== (finish === 'tool_calls')) return undefined;
  const hasRefusal = Object.hasOwn(value, 'refusal');
  const refusal = value.refusal;
  if (hasRefusal && refusal !== null && typeof refusal !== 'string') return undefined;
  const content = value.content;
  if (hasCalls) {
    if (
      (typeof content !== 'string' && content !== null && content !== undefined) ||
      (typeof refusal === 'string' && refusal.length > 0)
    )
      return undefined;
    const calls = functionCalls(toolCalls);
    if (!calls) return undefined;
    return {
      role: 'assistant',
      content: content === undefined ? null : content,
      ...(hasRefusal ? { refusal: refusal as null | string } : {}),
      ...reasoningContent,
      ...detailContent,
      tool_calls: calls,
    };
  }
  if (
    typeof content !== 'string' &&
    !(
      content === null &&
      (finish === 'content_filter' || (typeof refusal === 'string' && refusal.length > 0))
    )
  )
    return undefined;
  return {
    role: 'assistant',
    content,
    ...(hasRefusal && (typeof refusal === 'string' || refusal === null) ? { refusal } : {}),
    ...reasoningContent,
    ...detailContent,
  };
}
