import assert from 'node:assert/strict';
import { cacheControlFixture, cacheControlPrivacy } from './cache-control-fixture.ts';
export const blockFixture = cacheControlFixture;
export const blockParts = [
  {
    type: 'text' as const,
    text: 'private prefix 思考\n',
    cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
  },
  { type: 'text' as const, text: '' },
  { type: 'text' as const, text: ' private changing suffix ' },
];
export const blockHistory = [
  { role: 'system' as const, content: blockParts },
  { role: 'developer' as const, content: 'private developer' },
  { role: 'user' as const, content: blockParts },
  {
    role: 'assistant' as const,
    content: blockParts,
    tool_calls: [
      { id: 'previous', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } },
    ],
  },
  { role: 'tool' as const, tool_call_id: 'previous', content: 'private result' },
  { role: 'user' as const, content: 'private next question' },
];
export const delegatedBlockHistory = blockHistory.map((m) =>
  m.role === 'tool' ? { ...m, content: blockParts } : m,
);
export const expectedSystem = [
  ...blockParts,
  { type: 'text', text: '\n' },
  { type: 'text', text: 'private developer' },
];
export const expectedNativeHistory = [
  { role: 'user', content: blockParts },
  {
    role: 'assistant',
    content: [...blockParts, { type: 'tool_use', id: 'previous', name: 'lookup', input: {} }],
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'previous', content: 'private result' }],
  },
  { role: 'user', content: 'private next question' },
];
export function blockPrivacy(f: ReturnType<typeof blockFixture>) {
  cacheControlPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify([f.records, f.audits]),
    /cache_control|private prefix|changing suffix|ephemeral|ttl/u,
  );
}
export function sdkBlockHistory(kind: 'anthropic' | 'openrouter') {
  return (kind === 'openrouter' ? delegatedBlockHistory : blockHistory).map((message) => {
    const content =
      typeof message.content === 'string'
        ? message.content
        : message.content.map(({ cache_control, ...p }) => ({
            ...p,
            ...(cache_control ? { cacheControl: cache_control } : {}),
          }));
    if (message.role === 'tool')
      return { role: 'tool' as const, content, toolCallId: message.tool_call_id };
    if (message.role === 'assistant')
      return { role: 'assistant' as const, content, toolCalls: message.tool_calls };
    return { role: message.role, content };
  });
}
