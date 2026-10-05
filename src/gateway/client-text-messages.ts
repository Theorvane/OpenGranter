import { snapshotCacheControl } from './chat-parameters.ts';
import { type PromptCacheTextPart, snapshotPromptCacheBreakpoint } from './prompt-cache-parts.ts';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Normalize external text/refusal parts; retain keys for the protocol validator. */
export function normalizeClientTextMessages(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('Invalid client messages');
  const messages: Record<string, unknown>[] = [];
  for (const item of value) {
    const message = record(item);
    if (!message) throw new TypeError('Invalid client messages');
    const fields = { ...message };
    let content = Object.hasOwn(fields, 'content') ? fields.content : message.content;
    if (
      typeof content !== 'string' &&
      !((content === null || content === undefined) && fields.role === 'assistant')
    ) {
      if (!Array.isArray(content) || content.length === 0)
        throw new TypeError('Invalid client messages');
      const inputParts: readonly unknown[] = content;
      const parts = Array.from({ length: inputParts.length }, (_, index) => inputParts[index]);
      let text = '';
      const captured: PromptCacheTextPart[] = [];
      let marked = false;
      let refusal: string | undefined;
      for (const raw of parts) {
        const part = record(raw);
        if (!part) throw new TypeError('Invalid client messages');
        const type = part.type;
        if (type === 'refusal' && fields.role === 'assistant' && parts.length === 1) {
          const payload = part.refusal;
          if (
            !Object.hasOwn(part, 'type') ||
            !Object.hasOwn(part, 'refusal') ||
            typeof payload !== 'string' ||
            Object.keys(part).some((key) => key !== 'type' && key !== 'refusal') ||
            Object.hasOwn(fields, 'refusal')
          )
            throw new TypeError('Invalid client messages');
          refusal = payload;
          continue;
        }
        if (type !== 'text') throw new TypeError('Invalid client messages');
        const payload = part.text;
        if (
          typeof payload !== 'string' ||
          Object.keys(part).some(
            (key) => !['type', 'text', 'prompt_cache_breakpoint', 'cache_control'].includes(key),
          )
        )
          throw new TypeError('Invalid client messages');
        const marker = snapshotPromptCacheBreakpoint(
          Object.hasOwn(part, 'prompt_cache_breakpoint') ? part.prompt_cache_breakpoint : undefined,
        );
        const directive = Object.hasOwn(part, 'cache_control')
          ? snapshotCacheControl(part.cache_control)
          : undefined;
        if (marker !== undefined || directive !== undefined) marked = true;
        captured.push(
          Object.freeze({
            type: 'text',
            text: payload,
            ...(marker === undefined ? {} : { prompt_cache_breakpoint: marker }),
            ...(directive === undefined ? {} : { cache_control: directive }),
          }),
        );
        text += payload;
      }
      if (refusal !== undefined) {
        messages.push({ ...fields, content: null, refusal });
        continue;
      }
      content = marked ? Object.freeze(captured) : text;
    }
    messages.push({ ...fields, content: content === undefined ? null : content });
  }
  return messages;
}
