/** Display/input conversion only. Server time and lifetime policy remain authoritative. */
export function parseTokenExpiry(value: string): number | undefined {
  if (/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    const milliseconds = Number(value);
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return;
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return;
  const canonical = value.length === 20 ? `${value.slice(0, -1)}.000Z` : value;
  // Date.parse can silently normalize invalid days and 24:00 into another date.
  return new Date(milliseconds).toISOString() === canonical ? milliseconds : undefined;
}

export function tokenExpiryDescription(milliseconds: number): string {
  const date = new Date(milliseconds);
  const utc = Number.isFinite(date.getTime()) ? `UTC: ${date.toISOString()}; ` : '';
  return `${utc}expiry (Unix milliseconds): ${milliseconds}`;
}
