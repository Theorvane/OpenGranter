import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSsoAuditClient,
  createSsoAuditExportClient,
} from '../src/management/audit-client.ts';
import { createSsoUsageClient } from '../src/management/usage-client.ts';
import { createSsoUsageExportClient } from '../src/management/usage-export-client.ts';

const clients = [
  ['usage JSON', createSsoUsageClient],
  ['usage CSV', createSsoUsageExportClient],
  ['audit JSON', createSsoAuditClient],
  ['audit CSV', createSsoAuditExportClient],
] as const;
for (const [name, create] of clients) {
  for (const field of ['principalId', 'model'] as const) {
    test(`${name} rejects malformed ${field} before a request can change its meaning`, async () => {
      let calls = 0;
      const client = create(async () => {
        calls++;
        return new Response(null, { status: 403 });
      });
      for (const value of [
        '\ud800',
        '\udfff',
        'team/\ud800x',
        'x\udfff/tenant',
        '\ud800\ud800',
        '\udfff\ud800',
      ]) {
        assert.deepEqual(await client.read({ [field]: value }), { state: 'invalid_query' });
      }
      assert.equal(calls, 0);
      client.invalidate();
    });
    for (const status of [401, 403, 503]) {
      test(`${name} preserves valid ${field} scalar values with fresh HTTP ${status}`, async () => {
        for (const value of name.startsWith('audit') && field === 'principalId'
          ? ['team/human', 'a+b:c@d']
          : ['한글/😀', 'literal/�', 'e\u0301', 'é', 'a+b&c%/d']) {
          let calls = 0;
          const client = create(async (path) => {
            calls++;
            const params = new URL(path, 'https://test.invalid').searchParams;
            assert.equal(params.get(field === 'principalId' ? 'principal_id' : 'model'), value);
            return new Response(null, { status });
          });
          assert.deepEqual(await client.read({ [field]: value }), {
            state: status === 401 ? 'unauthenticated' : status === 403 ? 'denied' : 'unavailable',
          });
          assert.equal(calls, 1);
          client.invalidate();
        }
      });
    }
  }
}
