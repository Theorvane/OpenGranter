/** Optional client output maximum; supplied values must be positive safe integers. */
export function validOutputTokenLimit(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  );
}

/** Capture the portable stop subset without retaining mutable caller arrays. */
export function snapshotStopSequences(value: unknown): string | readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length > 4) throw new TypeError('Invalid stop sequences');
  const captured: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new TypeError('Invalid stop sequences');
    captured.push(item);
  }
  return Object.freeze(captured);
}
