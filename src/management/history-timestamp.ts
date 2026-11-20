/** Presentation only: never alter server filters, raw records or opaque cursors. */
export function formatHistoryTimestamp(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return 'UTC unavailable';
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime())
    ? `${milliseconds} Unix ms (UTC unavailable)`
    : `${date.toISOString()} (UTC)`;
}
