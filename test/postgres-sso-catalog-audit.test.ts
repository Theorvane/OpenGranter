import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoCatalogAuditStore } from '../src/audit/postgres-sso-catalog.ts';
import type { SsoCatalogAuditEvent } from '../src/gateway/postgres-sso-model-catalog.ts';

const event: SsoCatalogAuditEvent = {
  requestId: 'request-1',
  operation: 'list',
  outcome: 'ready',
  count: 2,
  principalId: 'human-1',
  policyVersions: [{ id: 'allow', version: 'v1' }],
};

test('persists real SSO attribution and anonymous failures without credentials or extras', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/012_sso_catalog_audit.sql', import.meta.url), 'utf8'),
    );
    const store = createPostgresSsoCatalogAuditStore(
      { query: (sql, params) => db.query(sql, [...params]) },
      () => 1000,
    );
    await store.append({ ...event, token: 'private', prompt: 'private' } as SsoCatalogAuditEvent);
    await store.append({ ...event, operation: 'detail', count: 1 });
    await store.append({ ...event, operation: 'detail', outcome: 'missing', count: 0 });
    await store.append({ ...event, outcome: 'unavailable', count: 0 });
    await store.append({
      requestId: 'request-2',
      operation: 'list',
      outcome: 'unauthenticated',
      count: 0,
      principalId: null,
      policyVersions: null,
    });
    await store.append({
      requestId: 'request-3',
      operation: 'list',
      outcome: 'unavailable',
      count: 0,
      principalId: null,
      policyVersions: null,
    });
    const rows = (
      await db.query<Record<string, unknown>>(
        'SELECT * FROM sso_catalog_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.equal(rows.length, 6);
    assert.deepEqual(rows[0], {
      event_id: 1,
      occurred_at_ms: 1000,
      request_id: 'request-1',
      operation: 'list',
      outcome: 'ready',
      model_count: 2,
      principal_id: 'human-1',
      policy_versions: [{ id: 'allow', version: 'v1' }],
    });
    assert.equal(rows[4]?.principal_id, null);
    assert.equal(JSON.stringify(rows).includes('private'), false);
    assert.equal(JSON.stringify(rows).includes('credential'), false);
    await assert.rejects(
      db.exec(
        "INSERT INTO sso_catalog_audit_events (occurred_at_ms, request_id, operation, outcome, model_count, principal_id, policy_versions) VALUES (1, 'r', 'list', 'ready', 1, NULL, NULL)",
      ),
    );
  } finally {
    await db.close();
  }
});

test('invalid attribution, bounds and outcomes fail before SQL', async () => {
  let calls = 0;
  const store = createPostgresSsoCatalogAuditStore(
    {
      query: async () => {
        calls++;
        return { rows: [{ event_id: '1' }] };
      },
    },
    () => 1,
  );
  const bad = [
    null,
    { ...event, requestId: '' },
    { ...event, requestId: 'x'.repeat(257) },
    { ...event, count: -1 },
    { ...event, count: 1.5 },
    { ...event, principalId: null },
    { ...event, policyVersions: null },
    { ...event, outcome: 'unauthenticated' },
    { ...event, outcome: 'missing', count: 0 },
    { ...event, operation: 'detail', count: 2 },
    { ...event, outcome: 'unavailable' },
    { ...event, policyVersions: [{ id: 'p', version: '' }] },
    { ...event, policyVersions: Array(1025).fill({ id: 'p', version: 'v' }) },
  ];
  for (const value of bad)
    await assert.rejects(store.append(value as SsoCatalogAuditEvent), {
      name: 'InvalidSsoCatalogAuditEvent',
    });
  assert.equal(calls, 0);
});

test('storage and clock failures are fixed and malformed acknowledgements fail', async () => {
  for (const rows of [[], [{ event_id: '0' }], [{ event_id: '1' }, { event_id: '2' }], [{}]]) {
    const store = createPostgresSsoCatalogAuditStore({ query: async () => ({ rows }) }, () => 1);
    await assert.rejects(store.append(event), {
      name: 'SsoCatalogAuditUnavailable',
      message: 'SSO catalog audit store unavailable',
    });
  }
  await assert.rejects(
    createPostgresSsoCatalogAuditStore(
      {
        query: async () => {
          throw Error('private database');
        },
      },
      () => 1,
    ).append(event),
    { message: 'SSO catalog audit store unavailable' },
  );
  let queries = 0;
  for (const now of [
    () => {
      throw Error('private clock');
    },
    () => -1,
    () => Number.NaN,
  ]) {
    await assert.rejects(
      createPostgresSsoCatalogAuditStore(
        {
          query: async () => {
            queries++;
            return { rows: [] };
          },
        },
        now,
      ).append(event),
    );
  }
  assert.equal(queries, 0);
});
