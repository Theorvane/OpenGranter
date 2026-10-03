import { normalizeProviderUsage } from '../usage/normalize-provider-tokens.ts';

const promptFields = [
  'cached_tokens',
  'cache_write_tokens',
  'audio_tokens',
  'video_tokens',
] as const;
const completionFields = [
  'reasoning_tokens',
  'audio_tokens',
  'accepted_prediction_tokens',
  'rejected_prediction_tokens',
] as const;

export type ChatUsage = NonNullable<ReturnType<typeof normalizeProviderUsage>> & {
  readonly prompt_tokens_details?: Readonly<
    Partial<Record<(typeof promptFields)[number], number>>
  > | null;
  readonly completion_tokens_details?: Readonly<
    Partial<Record<(typeof completionFields)[number], number | null>>
  > | null;
};

function snapshotDetails(
  value: unknown,
  fields: readonly string[],
  nullable: false,
): Readonly<Record<string, number>> | null | undefined;
function snapshotDetails(
  value: unknown,
  fields: readonly string[],
  nullable: true,
): Readonly<Record<string, number | null>> | null | undefined;
function snapshotDetails(
  value: unknown,
  fields: readonly string[],
  nullable: boolean,
): Readonly<Record<string, number | null>> | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const source = value as Record<string, unknown>;
  const captured: Record<string, number | null> = {};
  for (const field of fields) {
    if (!Object.hasOwn(source, field)) continue;
    const count = source[field];
    if (nullable && count === null) {
      captured[field] = null;
    } else if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
      captured[field] = count;
    } else {
      return undefined;
    }
  }
  return Object.freeze(captured);
}

/** Preserve bounded informational categories without changing aggregate accounting. */
function captureChatUsage(value: unknown, deriveTotal: boolean): ChatUsage | undefined {
  const aggregates = normalizeProviderUsage(value, undefined, deriveTotal);
  if (!aggregates) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return Object.freeze(aggregates);
  const source = value as Record<string, unknown>;
  const prompt = snapshotDetails(source.prompt_tokens_details, promptFields, false);
  const completion = snapshotDetails(source.completion_tokens_details, completionFields, true);
  return Object.freeze({
    ...aggregates,
    ...(prompt === undefined ? {} : { prompt_tokens_details: prompt }),
    ...(completion === undefined ? {} : { completion_tokens_details: completion }),
  });
}

/** Normalize upstream counters with existing total derivation and bounded categories. */
export function normalizeChatUsage(value: unknown): ChatUsage | undefined {
  return captureChatUsage(value, true);
}

/** Snapshot an independent usage boundary without inventing omitted aggregate totals. */
export function snapshotChatUsage(value: unknown): ChatUsage | undefined {
  return captureChatUsage(value, false);
}
