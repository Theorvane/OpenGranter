import {
  normalizeProviderTokens,
  normalizeProviderUsage,
} from '../usage/normalize-provider-tokens.ts';
import { type ChatUsage, snapshotChatUsage } from './chat-usage.ts';

const inputFields = [
  'input_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
] as const;
type Field = (typeof inputFields)[number] | 'output_tokens';
type Counters = Partial<Record<Field, number | null | undefined>>;
const validCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function scalar(value: unknown): number | null | undefined {
  // An invalid scalar marker retains availability without retaining opaque provider payloads.
  return value === null || value === undefined ? value : validCount(value) ? value : Number.NaN;
}
function capture(source: Record<string, unknown>, fields: readonly Field[]): Counters {
  const captured: Counters = {};
  for (const field of fields)
    if (Object.hasOwn(source, field)) captured[field] = scalar(source[field]);
  return captured;
}

/** Normalize disjoint native prompt partitions once; projected details never add another count. */
export function normalizeAnthropicChatUsage(value: unknown): ChatUsage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return snapshotChatUsage(normalizeProviderUsage(value, ['input_tokens', 'output_tokens']));
  const native = capture(value as Record<string, unknown>, [...inputFields, 'output_tokens']);
  let prompt = native.input_tokens;
  if (
    Object.hasOwn(native, 'cache_creation_input_tokens') ||
    Object.hasOwn(native, 'cache_read_input_tokens')
  ) {
    const components = inputFields.map((field) => native[field]);
    if (prompt === null || components.some((c) => c != null && !validCount(c))) prompt = null;
    else if (components.some((c) => c == null)) prompt = undefined;
    else {
      const sum = components.filter(validCount).reduce((sum, count) => sum + count, 0);
      prompt = validCount(sum) ? sum : null;
    }
  }
  const aggregate = normalizeProviderTokens(prompt, native.output_tokens, undefined);
  if (!aggregate) return undefined;
  const cached = native.cache_read_input_tokens,
    written = native.cache_creation_input_tokens;
  return snapshotChatUsage({
    ...aggregate,
    ...(validCount(cached) || validCount(written)
      ? {
          prompt_tokens_details: {
            ...(validCount(cached) ? { cached_tokens: cached } : {}),
            ...(validCount(written) ? { cache_write_tokens: written } : {}),
          },
        }
      : {}),
  });
}

/** Internal cumulative scalar snapshot; omitted/null input updates retain previous reports. */
export class AnthropicStreamUsage {
  private readonly counters: Counters;
  constructor(initial: Record<string, unknown> | undefined) {
    // Initial output is an estimate and cannot stand in for the final output report.
    this.counters = capture(initial ?? {}, inputFields);
  }
  update(delta: Record<string, unknown> | undefined): number | null | undefined {
    for (const field of inputFields) {
      if (!delta || !Object.hasOwn(delta, field)) continue;
      const value = delta[field];
      if (value != null) this.counters[field] = scalar(value);
    }
    this.counters.output_tokens =
      delta && Object.hasOwn(delta, 'output_tokens') ? scalar(delta.output_tokens) : undefined;
    return this.counters.output_tokens;
  }
  finish(): ChatUsage | undefined {
    return normalizeAnthropicChatUsage(this.counters);
  }
}
