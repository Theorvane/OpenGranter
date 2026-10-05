import type { CacheControl } from './chat-parameters.ts';

export interface PromptCacheBreakpoint {
  readonly mode: 'explicit';
}
export interface PromptCacheTextPart {
  readonly type: 'text';
  readonly text: string;
  readonly prompt_cache_breakpoint?: PromptCacheBreakpoint;
}
/** Nullable source markers normalize locally to omission, without native null claims. */
export function snapshotPromptCacheBreakpoint(value: unknown): PromptCacheBreakpoint | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid cache breakpoint');
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    !Object.hasOwn(value, 'mode') ||
    Object.keys(value).some((key) => key !== 'mode')
  )
    throw new TypeError('Invalid cache breakpoint');
  const mode: unknown = Reflect.get(value, 'mode');
  if (mode !== 'explicit') throw new TypeError('Invalid cache breakpoint');
  return Object.freeze({ mode });
}
/** Snapshot a marked text history; plain internal arrays retain their prior rejection. */
export function snapshotPromptCacheTextParts(value: unknown): readonly PromptCacheTextPart[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid chat messages');
  const source: readonly unknown[] = value,
    length = source.length;
  if (
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > 128 ||
    Object.keys(source).some((key) => !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= length)
  )
    throw new TypeError('Invalid chat messages');
  const parts: PromptCacheTextPart[] = [];
  let marked = false;
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(source, index)) throw new TypeError('Invalid chat messages');
    const raw = source[index];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      throw new TypeError('Invalid chat messages');
    const prototype = Object.getPrototypeOf(raw);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      !Object.hasOwn(raw, 'type') ||
      !Object.hasOwn(raw, 'text') ||
      Object.keys(raw).some((key) => !['type', 'text', 'prompt_cache_breakpoint'].includes(key))
    )
      throw new TypeError('Invalid chat messages');
    const type: unknown = Reflect.get(raw, 'type'),
      text: unknown = Reflect.get(raw, 'text');
    const marker = snapshotPromptCacheBreakpoint(
      Object.hasOwn(raw, 'prompt_cache_breakpoint')
        ? Reflect.get(raw, 'prompt_cache_breakpoint')
        : undefined,
    );
    if (type !== 'text' || typeof text !== 'string') throw new TypeError('Invalid chat messages');
    if (marker !== undefined) marked = true;
    parts.push(
      Object.freeze({
        type,
        text,
        ...(marker === undefined ? {} : { prompt_cache_breakpoint: marker }),
      }),
    );
  }
  if (!marked) throw new TypeError('Invalid chat messages');
  return Object.freeze(parts);
}
export function hasPromptCacheBreakpoints(
  messages: readonly { readonly content: unknown }[],
): boolean {
  return messages.some((message) => Array.isArray(message.content));
}
/** Keep request-level mixed-format precedence outside this bounded subset. */
export function validatePromptCacheHistory(
  cacheControl: CacheControl | undefined,
  messages: readonly { readonly content: unknown }[],
): void {
  if (cacheControl !== undefined && hasPromptCacheBreakpoints(messages))
    throw new TypeError('Unsupported cache controls');
}
/** Preserve the existing opt-in selector text view, including literal nullable content. */
export function chatContentText(content: string | null | readonly PromptCacheTextPart[]): string {
  if (content === null) return 'null';
  return typeof content === 'string' ? content : content.map((part) => part.text).join('');
}
