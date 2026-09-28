/** Project only recognized counters, preserving missing and invalid reporting. */
export function normalizeProviderTokens(
  prompt: unknown,
  completion: unknown,
  total: unknown,
):
  | {
      readonly prompt_tokens?: number | null;
      readonly completion_tokens?: number | null;
      readonly total_tokens?: number | null;
    }
  | undefined {
  const count = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const p = count(prompt);
  const c = count(completion);
  const t =
    total === undefined && p !== undefined && c !== undefined
      ? (count(p + c) ?? null)
      : total === undefined
        ? undefined
        : (count(total) ?? null);
  if (prompt === undefined && completion === undefined && t === undefined) return undefined;
  return {
    ...(prompt === undefined ? {} : { prompt_tokens: p ?? null }),
    ...(completion === undefined ? {} : { completion_tokens: c ?? null }),
    ...(t === undefined ? {} : { total_tokens: t }),
  };
}
