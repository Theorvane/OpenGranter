function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
/** Normalize only native text/function envelopes before shared structural validation. */
export function normalizeDirectOpenAIStreamEnvelope(payload: string, functions = false): string {
  if (payload === '[DONE]') return payload;
  const value = record(JSON.parse(payload) as unknown);
  if (!value) throw Error('Invalid direct OpenAI stream chunk');
  if (Object.hasOwn(value, 'error')) return JSON.stringify({ error: true });
  if (!Array.isArray(value.choices)) throw Error('Invalid direct OpenAI stream chunk');
  if (value.choices.length > 0) {
    if (value.choices.length !== 1) throw Error('Invalid direct OpenAI stream chunk');
    const choice = record(value.choices[0]),
      delta = record(choice?.delta);
    if (
      !choice ||
      !delta ||
      Object.hasOwn(choice, 'native_finish_reason') ||
      Object.keys(delta).some(
        (key) =>
          !['role', 'content', 'refusal', ...(functions ? ['tool_calls'] : [])].includes(key),
      )
    )
      throw Error('Invalid direct OpenAI stream chunk');
    if (Object.hasOwn(value, 'usage')) {
      if (value.usage !== null) throw Error('Invalid direct OpenAI stream chunk');
      delete value.usage;
    }
  }
  return JSON.stringify(value);
}
