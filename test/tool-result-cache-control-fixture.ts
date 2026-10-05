import { cachedTools } from './function-tool-cache-control-fixture.ts';
import { blockParts } from './text-block-cache-control-fixture.ts';
export const resultParts = [
  { type: 'text' as const, text: 'private result prefix 思考\n' },
  { type: 'text' as const, text: '' },
  {
    type: 'text' as const,
    text: ' private result end ',
    cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
  },
];
export const resultHistory = [
  { role: 'system' as const, content: blockParts },
  { role: 'user' as const, content: 'private question' },
  {
    role: 'assistant' as const,
    content: null,
    tool_calls: [
      { id: 'previous', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } },
    ],
  },
  { role: 'tool' as const, tool_call_id: 'previous', content: resultParts },
];
export const expectedResults = [
  {
    type: 'tool_result',
    tool_use_id: 'previous',
    content: resultParts.map(({ type, text }) => ({ type, text })),
    cache_control: { type: 'ephemeral', ttl: '1h' },
  },
];
export const expectedResultHistory = [
  { role: 'user', content: 'private question' },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'previous', name: 'lookup', input: {} }] },
  { role: 'user', content: expectedResults },
];
export const resultInput = {
  cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
  tools: cachedTools,
  messages: resultHistory,
};
export const sdkResultHistory = () =>
  resultHistory.map((m) => {
    if (m.role === 'assistant')
      return { role: 'assistant' as const, content: m.content, toolCalls: m.tool_calls };
    const content =
      typeof m.content === 'string' || m.content === null
        ? m.content
        : m.content.map((p) => {
            const { cache_control, ...text } = p;
            return { ...text, ...(cache_control ? { cacheControl: cache_control } : {}) };
          });
    if (m.role === 'tool') return { role: 'tool' as const, content, toolCallId: m.tool_call_id };
    return { role: m.role, content };
  });
