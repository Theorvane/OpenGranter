/** Bounded delta-seconds, IMF-fixdate or asctime HTTP-date, normalized at rejection capture. */
export function parseRetryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  if (value.length <= 16 && /^[0-9]+$/u.test(value)) {
    const seconds = Number(value);
    return validRetryAfterSeconds(seconds) ? seconds : undefined;
  }
  // RFC9110 asctime-date has an implicit UTC zone and a fixed 24-character shape.
  // Normalize only that grammar; the shared round-trip below still validates its calendar.
  if (
    value.length === 24 &&
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{2}| [0-9]) [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$/u.test(
      value,
    )
  ) {
    const day = value.slice(8, 10).replace(' ', '0');
    value = `${value.slice(0, 3)}, ${day} ${value.slice(4, 7)} ${value.slice(20)} ${value.slice(11, 19)} GMT`;
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
