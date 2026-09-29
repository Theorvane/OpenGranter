export interface ChatMessage {
  readonly role: 'system' | 'developer' | 'user' | 'assistant';
  readonly content: string;
}

/** Capture the portable text protocol before callers can mutate an async request. */
export function snapshotChatMessages(value: unknown): readonly ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('Invalid chat messages');
  const messages: ChatMessage[] = [];
  let conversationSeen = false;
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).some((key) => key !== 'role' && key !== 'content')
    ) {
      throw new TypeError('Invalid chat messages');
    }
    const { role, content } = item as Record<string, unknown>;
    if (
      (role !== 'system' && role !== 'developer' && role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string'
    )
      throw new TypeError('Invalid chat messages');
    const instruction = role === 'system' || role === 'developer';
    if (instruction && conversationSeen) throw new TypeError('Invalid chat messages');
    if (!instruction) conversationSeen = true;
    messages.push(Object.freeze({ role, content }));
  }
  return Object.freeze(messages);
}
