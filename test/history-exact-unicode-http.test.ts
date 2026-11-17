import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSsoAuditClient,
  createSsoAuditExportClient,
} from '../src/management/audit-client.ts';
import { createSsoUsageClient } from '../src/management/usage-client.ts';
import { createSsoUsageExportClient } from '../src/management/usage-export-client.ts';
import { historyPageSizeRuntime } from './history-page-size-runtime-fixture.ts';

// Real loopback HTTP and signed synthetic JWT/PGlite, not browser/company IdP acceptance.
test('exact model filters cross canonical HTTP unchanged; malformed filters never reach HTTP or audit', async () => {
  const f = await historyPageSizeRuntime();
  const clients = [
    createSsoUsageClient(f.request),
    createSsoUsageExportClient(f.request),
    createSsoAuditClient(f.request),
    createSsoAuditExportClient(f.request),
  ];
  try {
    for (const client of clients) {
      const before = f.statuses.length;
      const auditBefore = [await f.auditCount('usage'), await f.auditCount('audit')];
      for (const model of ['vendor/\ud800x', 'vendor/\udfff', '\udfff\ud800']) {
        assert.deepEqual(await client.read({ model }), { state: 'invalid_query' });
      }
      assert.equal(f.statuses.length, before);
      assert.deepEqual([await f.auditCount('usage'), await f.auditCount('audit')], auditBefore);
      for (const model of ['vendor/😀', 'literal/�', 'e\u0301', 'é']) {
        assert.equal((await client.read({ model })).state, 'ready');
        const last = f.statuses.at(-1);
        assert.equal(last?.status, 200);
        assert.equal(
          new URL(last?.path ?? '', 'https://test.invalid').searchParams.get('model'),
          model,
        );
      }
    }
    await f.deny();
    for (const client of clients) {
      assert.deepEqual(await client.read({ model: 'vendor/😀' }), { state: 'denied' });
      assert.equal(f.statuses.at(-1)?.status, 403);
    }
  } finally {
    for (const client of clients) client.invalidate();
    await f.close();
  }
});
