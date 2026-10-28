export type UpstreamStatus = 429 | 503;

/** Preserve only observed allowlisted statuses that agree with the adapter's classification. */
export function snapshotUpstreamStatus(
  category: unknown,
  value: unknown,
): UpstreamStatus | undefined {
  if (category === 'rate-limit' && value === 429) return 429;
  if (category === 'server-error' && value === 503) return 503;
  return undefined;
}
