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

/** Resolve equivalent client maxima without silently choosing a conflicting value. */
export function resolveOutputTokenLimit(
  maxTokens: unknown,
  maxCompletionTokens: unknown,
): number | undefined {
  const tokens = maxTokens ?? undefined;
  const completion = maxCompletionTokens ?? undefined;
  if (
    !validOutputTokenLimit(tokens) ||
    !validOutputTokenLimit(completion) ||
    (tokens !== undefined && completion !== undefined && tokens !== completion)
  ) {
    throw new TypeError('Invalid output token limit');
  }
  return completion ?? tokens;
}

/** Optional temperature; direct Anthropic uses its narrower native range. */
export function validTemperature(value: unknown, maximum: 1 | 2 = 2): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum)
  );
}

/** Optional nucleus-sampling probability; omission preserves the upstream default. */
export function validTopP(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
  );
}

/** The current response/accounting contract supports one choice only. */
export function validSingleChoice(value: unknown): value is 1 | undefined {
  return value === undefined || value === 1;
}

/** Bounded portable frequency/presence penalty; omission preserves native defaults. */
export function validPenalty(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= -2 && value <= 2)
  );
}

export interface ResponseFormat {
  readonly type: 'text' | 'json_object';
}
/** Capture the bounded output format without retaining mutable caller objects. */
export function snapshotResponseFormat(value: unknown): ResponseFormat | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid response format');
  const format = value as Record<string, unknown>;
  const keys = Object.keys(format);
  if (
    keys.length !== 1 ||
    keys[0] !== 'type' ||
    (format.type !== 'text' && format.type !== 'json_object')
  )
    throw new TypeError('Invalid response format');
  return Object.freeze({ type: format.type });
}

/** Nonnegative exact top-k values; omission preserves provider defaults. */
export function validTopK(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  );
}
