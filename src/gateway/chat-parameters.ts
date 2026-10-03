/** Optional client output maximum; supplied values must be positive safe integers. */
export function validOutputTokenLimit(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  );
}

/** Capture an opaque token-bias map before asynchronous routing and credential access. */
export function snapshotLogitBias(value: unknown): Readonly<Record<string, number>> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid logit bias');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('Invalid logit bias');
  const entries = Object.entries(value);
  if (entries.some(([, bias]) => typeof bias !== 'number' || !Number.isFinite(bias)))
    throw new TypeError('Invalid logit bias');
  return Object.freeze(Object.fromEntries(entries));
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

/** Preserve only exactly representable integer seeds; omission uses provider defaults. */
export function validSeed(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isSafeInteger(value));
}
export interface StreamOptions {
  readonly include_usage?: boolean;
}

/** Capture the bounded delegated stream options before asynchronous work. */
export function snapshotStreamOptions(value: unknown): StreamOptions | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid stream options');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('Invalid stream options');
  const entries = Object.entries(value);
  if (entries.some(([key, option]) => key !== 'include_usage' || typeof option !== 'boolean'))
    throw new TypeError('Invalid stream options');
  return Object.freeze(Object.fromEntries(entries));
}

export type Verbosity = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Optional delegated output detail control; omission preserves upstream defaults. */
export function validVerbosity(value: unknown): value is Verbosity | undefined {
  return (
    value === undefined ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  );
}

export type ReasoningEffort = 'max' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';

/** Optional delegated reasoning shorthand; omission preserves upstream defaults. */
export function validReasoningEffort(value: unknown): value is ReasoningEffort | undefined {
  return (
    value === undefined ||
    value === 'max' ||
    value === 'xhigh' ||
    value === 'high' ||
    value === 'medium' ||
    value === 'low' ||
    value === 'minimal' ||
    value === 'none'
  );
}

/** Optional sampling control; omission preserves the upstream default. */
export function validMinP(value: unknown): value is number | undefined {
  return validTopP(value);
}

/** Optional sampling control; omission preserves the upstream default. */
export function validTopA(value: unknown): value is number | undefined {
  return validTopP(value);
}
