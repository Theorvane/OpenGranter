import assert from 'node:assert/strict';
import { clientUserFixture, clientUserPrivacy } from './client-user-fixture.ts';
export const cacheOptionsFixture = clientUserFixture;
export const suppliedCacheOptions = { mode: 'explicit' as const, ttl: '30m' as const };
export function cacheOptionsPrivacy(f: ReturnType<typeof clientUserFixture>) {
  clientUserPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify([f.records, f.audits]),
    /prompt_cache_options|explicit|30m|private|forged/u,
  );
}
