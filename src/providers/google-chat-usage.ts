import { normalizeProviderUsage } from '../usage/normalize-provider-tokens.ts';
import { type ChatUsage, snapshotChatUsage } from './chat-usage.ts';

/** Project reported native categories without changing aggregate accounting or deriving Google totals. */
export function normalizeGoogleChatUsage(value: unknown): ChatUsage | undefined {
  const aggregates = normalizeProviderUsage(
    value,
    ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'],
    false,
  );
  if (!aggregates) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return snapshotChatUsage(aggregates);
  const source = value as Record<string, unknown>;
  const count = (field: string): number | undefined => {
    if (!Object.hasOwn(source, field)) return undefined;
    const supplied = source[field];
    return typeof supplied === 'number' && Number.isSafeInteger(supplied) && supplied >= 0
      ? supplied
      : undefined;
  };
  const cached = count('cachedContentTokenCount');
  const thoughts = count('thoughtsTokenCount');
  return snapshotChatUsage({
    ...aggregates,
    ...(cached === undefined ? {} : { prompt_tokens_details: { cached_tokens: cached } }),
    ...(thoughts === undefined
      ? {}
      : { completion_tokens_details: { reasoning_tokens: thoughts } }),
  });
}
