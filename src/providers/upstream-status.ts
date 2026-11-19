export type UpstreamStatus = 408 | 429 | 503 | 504;

/** Preserve only observed allowlisted statuses that agree with the adapter's classification. */
export function snapshotUpstreamStatus(
  category: unknown,
  value: unknown,
): UpstreamStatus | undefined {
  if (category === 'rate-limit' && value === 429) return 429;
  if (category === 'server-error' && (value === 503 || value === 504)) return value;
  if ((category === 'other' || category === 'upstream') && value === 408) return 408;
  return undefined;
}
