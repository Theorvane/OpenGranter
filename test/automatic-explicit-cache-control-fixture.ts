import { cachedTools } from './function-tool-cache-control-fixture.ts';
import {
  blockHistory,
  blockParts,
  expectedNativeHistory,
  sdkBlockHistory,
} from './text-block-cache-control-fixture.ts';
// Two explicit history directives plus one tool directive leave one automatic slot.
export const combinedHistory = blockHistory.map((m) =>
  m.role === 'user' && Array.isArray(m.content) ? { ...m, content: 'private plain question' } : m,
);
export const expectedCombinedHistory = expectedNativeHistory.map((m) =>
  m.role === 'user' && m.content === blockParts ? { ...m, content: 'private plain question' } : m,
);
export const combinedCacheInput = {
  cache_control: { type: 'ephemeral' as const },
  tools: cachedTools,
  messages: combinedHistory,
};
export const sdkCombinedHistory = () =>
  sdkBlockHistory('anthropic').map((m) =>
    m.role === 'user' && Array.isArray(m.content) ? { ...m, content: 'private plain question' } : m,
  );
