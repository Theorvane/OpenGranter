/** UTC-only HTML datetime-local transport. Never interpret in the browser zone. */
export function parseUsageUtcInput(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(value);
  if (!match) return Number.NaN;
  const canonical = `${match[1]}:${match[2] ?? '00'}.${(match[3] ?? '').padEnd(3, '0')}Z`;
  const epoch = Date.parse(canonical);
  if (!Number.isSafeInteger(epoch) || epoch < 0) return Number.NaN;
  return new Date(epoch).toISOString() === canonical ? epoch : Number.NaN;
}

export function usageUtcInput(epoch: number): string {
  if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > 253402300799999) return '';
  return new Date(epoch).toISOString().slice(0, -1);
}

export function formatUsageTime(epoch: number): string {
  const value = usageUtcInput(epoch);
  return value ? `${value}Z` : `${epoch} (epoch ms)`;
}
