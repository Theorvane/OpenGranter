import assert from 'node:assert/strict';
import { cacheControlFixture } from './cache-control-fixture.ts';
export const imageFixture = cacheControlFixture;
export const inlineUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSXcAAAAASUVORK5CYII=';
export const imagePart = {
  type: 'image_url' as const,
  image_url: { url: inlineUrl, detail: 'low' as const },
};
export const imageHistory = [
  {
    role: 'user' as const,
    content: [
      { type: 'text' as const, text: 'private image question Ω' },
      imagePart,
      { type: 'text' as const, text: '' },
    ],
  },
];
export function imagePrivacy(f: ReturnType<typeof imageFixture>) {
  assert.doesNotMatch(
    JSON.stringify({ records: f.records, audits: f.audits }),
    /image_url|imageUrl|base64|data:image|private image|iVBOR|detail/u,
  );
  for (const r of f.records) {
    assert.equal(r.principalId, 'user');
    assert.equal(r.credentialId, 'credential');
  }
}
