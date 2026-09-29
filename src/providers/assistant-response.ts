/** Narrow non-streaming assistant output; provider-specific errors remain at adapters. */
export interface AssistantResponse {
  readonly role: 'assistant';
  readonly content: string | null;
  readonly refusal?: string | null;
}
export function normalizeAssistantResponse(
  value: Record<string, unknown> | undefined,
  finish: unknown,
): AssistantResponse | undefined {
  if (value?.role !== 'assistant') return undefined;
  const hasRefusal = Object.hasOwn(value, 'refusal');
  const refusal = value.refusal;
  if (hasRefusal && refusal !== null && typeof refusal !== 'string') return undefined;
  const content = value.content;
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
  };
}
