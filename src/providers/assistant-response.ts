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

function functionCalls(
  value: readonly unknown[],
  length: number,
): readonly AssistantFunctionCall[] | undefined {
  const entries = Array.from({ length }, (_, index) => value[index]);
  const ids = new Set<string>();
  const calls: AssistantFunctionCall[] = [];
  for (const item of entries) {
    const call = record(item);
    const id = call?.id;
    const type = call?.type;
    const operation = record(call?.function);
    const name = operation?.name;
    const args = operation?.arguments;
    if (
      typeof id !== 'string' ||
      !id ||
      ids.has(id) ||
      type !== 'function' ||
      typeof name !== 'string' ||
      !name ||
      typeof args !== 'string'
    )
      return undefined;
    ids.add(id);
    calls.push({ id, type: 'function', function: { name, arguments: args } });
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
  const legacyCall = value.function_call;
  if (finish === 'function_call' || (legacyCall !== undefined && legacyCall !== null))
    return undefined;
  if (toolCalls !== undefined && toolCalls !== null && !Array.isArray(toolCalls)) return undefined;
  const callCount = Array.isArray(toolCalls) ? toolCalls.length : 0;
  if (!Number.isSafeInteger(callCount) || callCount < 0 || callCount > 128) return undefined;
  const hasCalls = callCount > 0;
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
    const calls = functionCalls(toolCalls as readonly unknown[], callCount);
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
  const noTextCompletion =
    (content === null || content === undefined) && (finish === 'stop' || finish === 'length');
  if (
    typeof content !== 'string' &&
    !noTextCompletion &&
    !(
      content === null &&
      (finish === 'content_filter' || (typeof refusal === 'string' && refusal.length > 0))
    )
  )
    return undefined;
  return {
    role: 'assistant',
    content: content === undefined ? null : content,
    ...(hasRefusal && (typeof refusal === 'string' || refusal === null) ? { refusal } : {}),
    ...reasoningContent,
    ...detailContent,
  };
}
