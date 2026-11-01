/** Bounded delta-seconds or canonical IMF-fixdate, normalized at rejection capture. */
export function parseRetryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  if (value.length <= 16 && /^[0-9]+$/u.test(value)) {
    const seconds = Number(value);
    return validRetryAfterSeconds(seconds) ? seconds : undefined;
  }
  if (
    value.length !== 29 ||
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/u.test(
      value,
    ) ||
    Number(value.slice(12, 16)) < 1601 ||
    !Number.isFinite(now) ||
    Math.abs(now) > 8.64e15
  )
    return undefined;
  const timestamp = Date.parse(value);
  // Round-trip rejects normalized overflow, weekday mismatches and permissive parser extensions.
  if (!Number.isFinite(timestamp) || new Date(timestamp).toUTCString() !== value) return undefined;
  const seconds = Math.max(0, Math.ceil((timestamp - now) / 1000));
  return validRetryAfterSeconds(seconds) ? seconds : undefined;
}

export function validRetryAfterSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
