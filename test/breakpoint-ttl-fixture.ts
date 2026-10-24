import { breakpointHistory, sdkBreakpointHistory } from './prompt-cache-breakpoints-fixture.ts';

export function ttlHistory(ttl: '30m' | '12h' = '12h') {
  return breakpointHistory.map((message) => ({
    ...message,
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part) => ({
            ...part,
            ...(part.prompt_cache_breakpoint
              ? { prompt_cache_breakpoint: { mode: 'explicit' as const, ttl } }
              : {}),
          })),
  }));
}
export function sdkTtlHistory() {
  return sdkBreakpointHistory.map((message) => ({
    ...message,
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part) => ({
            ...part,
            ...(part.promptCacheBreakpoint
              ? { promptCacheBreakpoint: { mode: 'explicit' as const, ttl: '12h' as const } }
              : {}),
          })),
  }));
}
