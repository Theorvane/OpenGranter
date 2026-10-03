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

export type NonstreamChatUsage = NonNullable<ReturnType<typeof normalizeProviderUsage>> & {
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
export function normalizeNonstreamChatUsage(value: unknown): NonstreamChatUsage | undefined {
  const aggregates = normalizeProviderUsage(value);
  if (!aggregates) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return aggregates;
  const source = value as Record<string, unknown>;
  const prompt = snapshotDetails(source.prompt_tokens_details, promptFields, false);
  const completion = snapshotDetails(source.completion_tokens_details, completionFields, true);
  return Object.freeze({
    ...aggregates,
    ...(prompt === undefined ? {} : { prompt_tokens_details: prompt }),
    ...(completion === undefined ? {} : { completion_tokens_details: completion }),
  });
}
