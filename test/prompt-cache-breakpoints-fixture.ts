import assert from 'node:assert/strict';
import { clientUserFixture, clientUserPrivacy } from './client-user-fixture.ts';
export const breakpointFixture = clientUserFixture;
export const breakpointParts = [
  {
    type: 'text' as const,
    text: 'private reusable 思考\n',
    prompt_cache_breakpoint: { mode: 'explicit' as const },
  },
  { type: 'text' as const, text: '' },
  { type: 'text' as const, text: '  private changing suffix  ' },
];
export const breakpointHistory = [
  { role: 'system' as const, content: breakpointParts },
  { role: 'developer' as const, content: breakpointParts },
  { role: 'user' as const, content: breakpointParts },
  {
    role: 'assistant' as const,
    content: breakpointParts,
    tool_calls: [
      { id: 'previous', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } },
    ],
  },
  { role: 'tool' as const, content: breakpointParts, tool_call_id: 'previous' },
  { role: 'user' as const, content: 'private next question' },
];
export const sdkBreakpointHistory = [
  {
    role: 'system' as const,
    content: breakpointParts.map(({ prompt_cache_breakpoint, ...part }) => ({
      ...part,
      ...(prompt_cache_breakpoint ? { promptCacheBreakpoint: prompt_cache_breakpoint } : {}),
    })),
  },
  {
    role: 'developer' as const,
    content: breakpointParts.map(({ prompt_cache_breakpoint, ...part }) => ({
      ...part,
      ...(prompt_cache_breakpoint ? { promptCacheBreakpoint: prompt_cache_breakpoint } : {}),
    })),
  },
  {
    role: 'user' as const,
    content: breakpointParts.map(({ prompt_cache_breakpoint, ...part }) => ({
      ...part,
      ...(prompt_cache_breakpoint ? { promptCacheBreakpoint: prompt_cache_breakpoint } : {}),
    })),
  },
  {
    role: 'assistant' as const,
    content: breakpointParts.map(({ prompt_cache_breakpoint, ...part }) => ({
      ...part,
      ...(prompt_cache_breakpoint ? { promptCacheBreakpoint: prompt_cache_breakpoint } : {}),
    })),
    toolCalls: [
      { id: 'previous', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } },
    ],
  },
  {
    role: 'tool' as const,
    content: breakpointParts.map(({ prompt_cache_breakpoint, ...part }) => ({
      ...part,
      ...(prompt_cache_breakpoint ? { promptCacheBreakpoint: prompt_cache_breakpoint } : {}),
    })),
    toolCallId: 'previous',
  },
  { role: 'user' as const, content: 'private next question' },
];
export function breakpointPrivacy(f: ReturnType<typeof clientUserFixture>) {
  clientUserPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify([f.records, f.audits]),
    /prompt_cache_breakpoint|private reusable|changing suffix/u,
  );
}
