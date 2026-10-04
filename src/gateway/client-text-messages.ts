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
      const sole = content.length === 1 ? record(content[0]) : undefined;
      if (fields.role === 'assistant' && sole?.type === 'refusal') {
        const refusal = sole.refusal;
        if (
          !Object.hasOwn(sole, 'type') ||
          !Object.hasOwn(sole, 'refusal') ||
          typeof refusal !== 'string' ||
          Object.keys(sole).some((key) => key !== 'type' && key !== 'refusal') ||
          Object.hasOwn(fields, 'refusal')
        )
          throw new TypeError('Invalid client messages');
        messages.push({ ...fields, content: null, refusal });
        continue;
      }
      let text = '';
      for (const raw of content) {
        const part = record(raw);
        if (
          part?.type !== 'text' ||
          typeof part.text !== 'string' ||
          Object.keys(part).some((key) => key !== 'type' && key !== 'text')
        )
          throw new TypeError('Invalid client messages');
        text += part.text;
      }
      content = text;
    }
    messages.push({ ...fields, content: content === undefined ? null : content });
  }
  return messages;
}
