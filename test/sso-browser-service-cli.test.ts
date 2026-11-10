import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('explicit SSO executable exits safely on invalid config and missing trusted module', () => {
  for (const [module, expected] of [
    ['', 'Gateway configuration invalid\n'],
    ['/private/deployment/absent-sso-module.ts', 'Gateway startup unavailable\n'],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/start-sso-browser.ts'],
      {
        env: { PATH: process.env.PATH, OPENGRANTER_BOOTSTRAP_MODULE: module },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, expected);
  }
});
