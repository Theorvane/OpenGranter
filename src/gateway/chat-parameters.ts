/** Optional client output maximum; supplied values must be positive safe integers. */
export function validOutputTokenLimit(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  );
}

/** Resolve equivalent client maxima without silently choosing a conflicting value. */
export function resolveOutputTokenLimit(
  maxTokens: unknown,
  maxCompletionTokens: unknown,
): number | undefined {
  if (
    !validOutputTokenLimit(maxTokens) ||
    !validOutputTokenLimit(maxCompletionTokens) ||
    (maxTokens !== undefined &&
      maxCompletionTokens !== undefined &&
      maxTokens !== maxCompletionTokens)
  ) {
    throw new TypeError('Invalid output token limit');
  }
  return maxCompletionTokens ?? maxTokens;
}
