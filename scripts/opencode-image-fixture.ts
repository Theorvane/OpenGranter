import assert from 'node:assert/strict';
import type { OpenCodeNativeProvider } from './opencode-native-fixture.ts';

// Synthetic one-pixel PNG, never downloaded or inferred from a real prompt.
export const OPENCODE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
export const OPENCODE_IMAGE_URL = `data:image/png;base64,${OPENCODE_IMAGE_BASE64}`;

/** Inspect mocked transport requests only; this grants no fetch or model authority. */
export function openCodeImageCount(
  body: Record<string, unknown>,
  provider: OpenCodeNativeProvider,
): number {
  const history = provider === 'google' ? body.contents : body.messages;
  assert.ok(Array.isArray(history));
  let count = 0;
  for (const message of history) {
    assert.ok(message && typeof message === 'object');
    if (message.role !== 'user') continue;
    const parts = provider === 'google' ? message.parts : message.content;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      assert.ok(part && typeof part === 'object');
      if (provider === 'openai' && part.type === 'image_url') {
        assert.deepEqual(part, { type: 'image_url', image_url: { url: OPENCODE_IMAGE_URL } });
        count++;
      } else if (provider === 'anthropic' && part.type === 'image') {
        assert.deepEqual(part, {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: OPENCODE_IMAGE_BASE64 },
        });
        count++;
      } else if (provider === 'google' && Object.hasOwn(part, 'inlineData')) {
        assert.deepEqual(part, {
          inlineData: { mimeType: 'image/png', data: OPENCODE_IMAGE_BASE64 },
        });
        count++;
      }
    }
  }
  return count;
}
