import type { ChatMessage } from './chat-messages.ts';
import {
  type CacheControl,
  type PromptCacheOptions,
  snapshotCacheControl,
} from './chat-parameters.ts';
import type { FunctionTool } from './chat-tools.ts';
import {
  hasInlineImages,
  type InlineImagePart,
  MAX_INLINE_IMAGE_HISTORY_UNITS,
  snapshotInlineImagePart,
} from './inline-image-parts.ts';

export interface PromptCacheBreakpoint {
  readonly mode: 'explicit';
}
export interface PromptCacheTextPart {
  readonly type: 'text';
  readonly text: string;
  readonly prompt_cache_breakpoint?: PromptCacheBreakpoint;
  readonly cache_control?: CacheControl;
}
export type ChatContentPart = PromptCacheTextPart | InlineImagePart;
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
export function snapshotPromptCacheTextParts(value: unknown): readonly PromptCacheTextPart[];
export function snapshotPromptCacheTextParts(
  value: unknown,
  allowImages: true,
): readonly ChatContentPart[];
export function snapshotPromptCacheTextParts(
  value: unknown,
  allowImages = false,
): readonly ChatContentPart[] {
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
  const parts: ChatContentPart[] = [];
  let marked = false;
  let images = false;
  let imageUnits = 0;
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(source, index)) throw new TypeError('Invalid chat messages');
    const raw = source[index];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      throw new TypeError('Invalid chat messages');
    const prototype = Object.getPrototypeOf(raw);
    if ((prototype !== Object.prototype && prototype !== null) || !Object.hasOwn(raw, 'type'))
      throw new TypeError('Invalid chat messages');
    const type: unknown = Reflect.get(raw, 'type');
    if (type === 'image_url' && allowImages) {
      const captured = snapshotInlineImagePart(raw, type);
      imageUnits += captured.image_url.url.length;
      if (imageUnits > MAX_INLINE_IMAGE_HISTORY_UNITS) throw new TypeError('Invalid chat messages');
      parts.push(captured);
      images = true;
      continue;
    }
    if (
      !Object.hasOwn(raw, 'text') ||
      Object.keys(raw).some(
        (key) => !['type', 'text', 'prompt_cache_breakpoint', 'cache_control'].includes(key),
      )
    )
      throw new TypeError('Invalid chat messages');
    const text: unknown = Reflect.get(raw, 'text');
    const marker = snapshotPromptCacheBreakpoint(
      Object.hasOwn(raw, 'prompt_cache_breakpoint')
        ? Reflect.get(raw, 'prompt_cache_breakpoint')
        : undefined,
    );
    const directive = Object.hasOwn(raw, 'cache_control')
      ? snapshotCacheControl(Reflect.get(raw, 'cache_control'))
      : undefined;
    if (type !== 'text' || typeof text !== 'string') throw new TypeError('Invalid chat messages');
    if (directive !== undefined && text.length === 0) throw new TypeError('Invalid chat messages');
    if (marker !== undefined || directive !== undefined) marked = true;
    parts.push(
      Object.freeze({
        type,
        text,
        ...(marker === undefined ? {} : { prompt_cache_breakpoint: marker }),
        ...(directive === undefined ? {} : { cache_control: directive }),
      }),
    );
  }
  if ((!marked && !images) || (images && marked)) throw new TypeError('Invalid chat messages');
  return Object.freeze(parts);
}
export function hasPromptCacheBreakpoints(
  messages: readonly { readonly content: string | null | readonly ChatContentPart[] }[],
): boolean {
  return messages.some(
    ({ content }) =>
      typeof content !== 'string' &&
      content !== null &&
      content.some((part) => part.prompt_cache_breakpoint !== undefined),
  );
}
export function hasBlockCacheControls(
  messages: readonly { readonly content: string | null | readonly ChatContentPart[] }[],
): boolean {
  return messages.some(
    ({ content }) =>
      typeof content !== 'string' &&
      content !== null &&
      content.some((part) => part.cache_control !== undefined),
  );
}
/** Anthropic promotes only the last nested result marker; earlier boundaries cannot move. */
export function finalToolResultCacheControl(
  content: string | readonly ChatContentPart[],
): CacheControl | undefined {
  if (typeof content === 'string') return undefined;
  if (content.some((part) => part.type !== 'text'))
    throw new TypeError('Unsupported cache controls');
  const last = content.at(-1)?.cache_control;
  if (
    last === undefined ||
    !content.at(-1)?.text?.length ||
    content.some(
      (part, index) =>
        part.prompt_cache_breakpoint !== undefined ||
        (index < content.length - 1 && part.cache_control !== undefined),
    )
  )
    throw new TypeError('Unsupported cache controls');
  return last;
}
/** Identify the last eligible block in the supported tools/system/messages projection. */
function automaticTarget(
  messages: readonly ChatMessage[],
  tools: readonly FunctionTool[] | undefined,
): CacheControl | undefined {
  let target = tools?.at(-1)?.cache_control;
  const instructions = messages.filter((m) => m.role === 'system' || m.role === 'developer');
  if (instructions.every((m) => typeof m.content === 'string')) {
    // All-string instructions become one joined block, including nonempty newline separators.
    if (instructions.length > 1 || instructions.some((m) => m.content?.length)) target = undefined;
  } else {
    for (const [index, message] of instructions.entries()) {
      if (index > 0) target = undefined; // Native newline separator is eligible text.
      const content = message.content;
      if (typeof content === 'string') {
        if (content.length) target = undefined;
      } else if (content !== null) {
        for (const part of content)
          if (part.type === 'text' && part.text.length) target = part.cache_control;
      }
    }
  }
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;
    const content = message.content;
    if (message.role === 'tool') {
      // The outer result is eligible even when its string is empty; final nested markers promote.
      target = finalToolResultCacheControl(message.content);
    } else {
      if (typeof content === 'string') {
        if (content.length) target = undefined;
      } else if (content !== null) {
        for (const part of content)
          if (part.type === 'text' && part.text.length) target = part.cache_control;
      }
      // Native tool_use blocks follow assistant text rather than sharing its marker.
      if (message.tool_calls?.length) target = undefined;
    }
  }
  return target;
}
/** Keep mixed formats unsupported; admit documented same-format automatic/explicit controls. */
export function validatePromptCacheHistory(
  cacheControl: CacheControl | undefined,
  messages: readonly ChatMessage[],
  options?: PromptCacheOptions,
  tools?: readonly FunctionTool[],
): void {
  const breakpoints = hasPromptCacheBreakpoints(messages),
    blocks =
      hasBlockCacheControls(messages) ||
      (tools?.some((tool) => tool.cache_control !== undefined) ?? false);
  if (
    hasInlineImages(messages) &&
    (cacheControl !== undefined || options !== undefined || breakpoints || blocks)
  )
    throw new TypeError('Unsupported cache controls');
  if (
    (cacheControl !== undefined && breakpoints) ||
    (blocks && (breakpoints || options !== undefined))
  )
    throw new TypeError('Unsupported cache controls');
  let count = 0,
    shortSeen = false;
  const directives = [...(tools ?? []).map((tool) => tool.cache_control)];
  for (const { content } of messages) {
    if (typeof content === 'string' || content === null) continue;
    for (const part of content) directives.push(part.cache_control);
  }
  for (const directive of directives) {
    if (directive === undefined) continue;
    if (++count > (cacheControl === undefined ? 4 : 3) || (directive.ttl === '1h' && shortSeen))
      throw new TypeError('Unsupported cache controls');
    if (directive.ttl !== '1h') shortSeen = true;
  }
  if (cacheControl !== undefined && blocks) {
    const target = automaticTarget(messages, tools);
    if (
      (target !== undefined && (target.ttl ?? '5m') !== (cacheControl.ttl ?? '5m')) ||
      (cacheControl.ttl === '1h' && shortSeen)
    )
      throw new TypeError('Unsupported cache controls');
  }
}
/** Preserve the existing opt-in selector text view, including literal nullable content. */
export function chatContentText(content: string | null | readonly ChatContentPart[]): string {
  if (content === null) return 'null';
  if (Array.isArray(content) && content.some((part) => part.type !== 'text'))
    throw new TypeError('Unsupported selector content');
  return typeof content === 'string' ? content : content.map((part) => part.text).join('');
}
