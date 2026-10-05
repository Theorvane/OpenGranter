import assert from 'node:assert/strict';
import { cacheControlFixture, cacheControlPrivacy } from './cache-control-fixture.ts';
export const toolCacheFixture = cacheControlFixture;
export const cachedTools = [
  {
    type: 'function' as const,
    function: {
      name: 'lookup',
      description: 'private function description 思考',
      parameters: { type: 'object' },
      strict: true,
    },
    cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
  },
];
export const expectedNativeTools = [
  {
    name: 'lookup',
    description: 'private function description 思考',
    input_schema: { type: 'object' },
    strict: true,
    cache_control: { type: 'ephemeral', ttl: '1h' },
  },
];
export const sdkCachedTools = cachedTools.map(({ cache_control, ...tool }) => ({
  ...tool,
  cacheControl: cache_control,
}));
export function toolCachePrivacy(f: ReturnType<typeof toolCacheFixture>) {
  cacheControlPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify([f.records, f.audits]),
    /cache_control|ephemeral|private function|ttl/u,
  );
}
