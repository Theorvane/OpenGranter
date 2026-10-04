export interface ReasoningSummaryConfiguration {
  readonly summary?: 'auto' | 'concise' | 'detailed' | null;
}

/** Capture the supported summary preference without inventing reasoning defaults. */
export function snapshotReasoningSummary(
  value: unknown,
): ReasoningSummaryConfiguration | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid reasoning configuration');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('Invalid reasoning configuration');
  if (Object.keys(value).some((key) => key !== 'summary'))
    throw new TypeError('Invalid reasoning configuration');
  if (!Object.hasOwn(value, 'summary')) return Object.freeze({});
  const summary = (value as Record<string, unknown>).summary;
  if (summary !== null && summary !== 'auto' && summary !== 'concise' && summary !== 'detailed')
    throw new TypeError('Invalid reasoning configuration');
  return Object.freeze({ summary });
}
