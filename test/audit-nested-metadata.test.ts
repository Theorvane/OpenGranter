import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import {
  InvalidGatewayAuditEvent,
  projectGatewayAuditEvent,
} from '../src/audit/gateway-event-projection.ts';
import { projectAuditHistoryPage } from '../src/audit/history-http.ts';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';

const base = {
  kind: 'selection-started' as const,
  requestId: 'trace:One',
  principalId: 'alice',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'allow', version: 'v1' }],
  routeVersion: 'v1',
  modelAlias: 'chat',
  eligibleCandidateIds: ['candidate-1'],
};
const pageEvent = (event: typeof base) => ({
  eventId: '3',
  occurredAt: 1000,
  kind: event.kind,
  requestId: event.requestId,
  principalId: event.principalId,
  credentialId: event.credentialId,
  policyVersions: event.policyVersions,
  details: {
    routeVersion: event.routeVersion,
    modelAlias: event.modelAlias,
    eligibleCandidateIds: event.eligibleCandidateIds,
  },
});

async function browser(entry: string) {
  const built = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
  });
  assert.equal(
    Object.keys(built.metafile.inputs).some((path) => /\/postgres-[^/]+\.ts$/u.test(path)),
    false,
  );
  const source = built.outputFiles[0]?.text;
  assert.ok(source);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

for (const field of ['policyVersions', 'eligibleCandidateIds'] as const) {
  for (const position of [0, 1, 2]) {
    const entries =
      field === 'policyVersions'
        ? [base.policyVersions[0], base.policyVersions[0], base.policyVersions[0]]
        : ['candidate-1', 'candidate-2', 'candidate-3'];
    delete entries[position];
    const malformed = { ...base, [field]: entries } as typeof base;
    test(`${field} hole ${position} rejects before durable insert and HTTP projection`, async () => {
      assert.throws(() => projectGatewayAuditEvent(malformed, 1000), InvalidGatewayAuditEvent);
      assert.throws(
        () =>
          projectAuditHistoryPage(
            { events: [pageEvent(malformed)], nextCursor: null },
            'alice',
            50,
            null,
          ),
        InvalidGatewayAuditEvent,
      );
      let inserts = 0;
      const store = createPostgresGatewayAuditStore(
        {
          query: async () => {
            inserts++;
            return { rows: [{ event_id: '1' }] };
          },
        },
        () => 1000,
      );
      await assert.rejects(store.append(malformed), InvalidGatewayAuditEvent);
      assert.equal(inserts, 0);
    });
    test(`${field} hole ${position} withholds compiled browser JSON and CSV`, async () => {
      const json = await browser('src/management/audit-client.ts');
      const csv = await browser('src/management/audit-export-client.ts');
      // Wire serialization converts a missing nested entry into null; never publish it as evidence.
      const request = async () =>
        Response.json({
          object: 'list',
          data: [pageEvent(malformed)],
          has_more: false,
          next_cursor: null,
        });
      assert.deepEqual(
        await json.createAuditHistoryClient(request).read({ principalId: 'alice' }),
        { state: 'unavailable' },
      );
      assert.deepEqual(
        await csv.createAuditPageExportClient(request).read({ principalId: 'alice' }),
        { state: 'unavailable' },
      );
    });
  }
}

test('dense and empty nested evidence survives migrated SQL and compiled browser review/export', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/003_gateway_audit.sql', import.meta.url), 'utf8'),
    );
    const sql = {
      query: (text: string, params: readonly unknown[]) => db.query(text, [...params]),
    };
    const store = createPostgresGatewayAuditStore(sql, () => 1000);
    const incomplete = { ...base, policyVersions: new Array(1) };
    await assert.rejects(store.append(incomplete), InvalidGatewayAuditEvent);
    const rows = await db.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM gateway_audit_events',
    );
    assert.equal(rows.rows[0]?.count, 0);
    await store.append(base);
    await store.append({
      ...base,
      requestId: 'empty',
      policyVersions: [],
      eligibleCandidateIds: [],
    });
    const reader = createPostgresAuditHistoryReader(sql);
    const page = await reader({ principalId: 'alice', limit: 10, cursor: null });
    assert.equal(page.events.length, 2);
    const json = await browser('src/management/audit-client.ts');
    const csv = await browser('src/management/audit-export-client.ts');
    const request = async () =>
      Response.json({ object: 'list', data: page.events, has_more: false, next_cursor: null });
    const result = await json.createAuditHistoryClient(request).read({ principalId: 'alice' });
    assert.equal(result.state, 'ready');
    assert.deepEqual(result.data[0].policyVersions, []);
    assert.deepEqual(result.data[1].policyVersions, base.policyVersions);
    assert.deepEqual(result.data[1].details.eligibleCandidateIds, base.eligibleCandidateIds);
    assert.equal(
      (await csv.createAuditPageExportClient(request).read({ principalId: 'alice' })).state,
      'ready',
    );
  } finally {
    await db.close();
  }
});
