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
          Object.keys(part).some((key) => key !== 'type' && key !== 'text')
        )
          throw new TypeError('Invalid client messages');
        text += payload;
      }
      if (refusal !== undefined) {
        messages.push({ ...fields, content: null, refusal });
        continue;
      }
      content = text;
    }
    messages.push({ ...fields, content: content === undefined ? null : content });
  }
  return messages;
}
