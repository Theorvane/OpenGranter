import type { ChatMessage } from './chat-messages.ts';
import {
  type CacheControl,
  type PromptCacheOptions,
  snapshotCacheControl,
} from './chat-parameters.ts';
import type { FunctionTool } from './chat-tools.ts';

export interface PromptCacheBreakpoint {
  readonly mode: 'explicit';
}
export interface PromptCacheTextPart {
  readonly type: 'text';
  readonly text: string;
  readonly prompt_cache_breakpoint?: PromptCacheBreakpoint;
  readonly cache_control?: CacheControl;
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
      Object.keys(raw).some(
        (key) => !['type', 'text', 'prompt_cache_breakpoint', 'cache_control'].includes(key),
      )
    )
      throw new TypeError('Invalid chat messages');
    const type: unknown = Reflect.get(raw, 'type'),
      text: unknown = Reflect.get(raw, 'text');
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
  if (!marked) throw new TypeError('Invalid chat messages');
  return Object.freeze(parts);
}
export function hasPromptCacheBreakpoints(
  messages: readonly { readonly content: string | null | readonly PromptCacheTextPart[] }[],
): boolean {
  return messages.some(
    ({ content }) =>
      typeof content !== 'string' &&
      content !== null &&
      content.some((part) => part.prompt_cache_breakpoint !== undefined),
  );
}
export function hasBlockCacheControls(
  messages: readonly { readonly content: string | null | readonly PromptCacheTextPart[] }[],
): boolean {
  return messages.some(
    ({ content }) =>
      typeof content !== 'string' &&
      content !== null &&
      content.some((part) => part.cache_control !== undefined),
  );
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
        for (const part of content) if (part.text.length) target = part.cache_control;
      }
    }
  }
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;
    const content = message.content;
    if (message.role === 'tool') {
      target = undefined; // The outer tool_result is eligible even when its string is empty.
    } else {
      if (typeof content === 'string') {
        if (content.length) target = undefined;
      } else if (content !== null) {
        for (const part of content) if (part.text.length) target = part.cache_control;
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
    // Nested result markers need their own boundary-preserving mapping before coexistence.
    if (messages.some((m) => m.role === 'tool' && typeof m.content !== 'string'))
      throw new TypeError('Unsupported cache controls');
    const target = automaticTarget(messages, tools);
    if (
      (target !== undefined && (target.ttl ?? '5m') !== (cacheControl.ttl ?? '5m')) ||
      (cacheControl.ttl === '1h' && shortSeen)
    )
      throw new TypeError('Unsupported cache controls');
  }
}
/** Preserve the existing opt-in selector text view, including literal nullable content. */
export function chatContentText(content: string | null | readonly PromptCacheTextPart[]): string {
  if (content === null) return 'null';
  return typeof content === 'string' ? content : content.map((part) => part.text).join('');
}
