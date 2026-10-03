/** Validate a provider usage container before projecting its known counters. */
export function normalizeProviderUsage(
  value: unknown,
  fields: readonly [prompt: string, completion: string, total?: string] = [
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
  ],
  deriveTotal = true,
): ReturnType<typeof normalizeProviderTokens> {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return { total_tokens: null };
  const container = value as Record<string, unknown>;
  return normalizeProviderTokens(
    container[fields[0]],
    container[fields[1]],
    fields[2] === undefined ? undefined : container[fields[2]],
    deriveTotal,
  );
}

/** Project only recognized counters, preserving missing and invalid reporting. */
export function normalizeProviderTokens(
  prompt: unknown,
  completion: unknown,
  total: unknown,
  deriveTotal = true,
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
    deriveTotal && total === undefined && p !== undefined && c !== undefined
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
