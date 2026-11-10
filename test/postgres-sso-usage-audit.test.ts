import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoUsageAuditStore } from '../src/audit/postgres-sso-usage-history.ts';
import type { SsoUsageAuditEvent } from '../src/gateway/postgres-sso-usage-history.ts';

const event: SsoUsageAuditEvent = {
  requestId: 'server-1',
  principalId: 'human',
  policyVersions: [{ id: 'p', version: 'v1' }],
  targetPrincipalId: 'human',
  mode: 'self',
  outcome: 'ready',
  count: 2,
};
test('durable usage metadata projects fields and supports anonymous unavailable and ReadAll', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/013_sso_usage_audit.sql', import.meta.url), 'utf8'),
    );
    const store = createPostgresSsoUsageAuditStore(
      { query: (sql, params) => db.query(sql, [...params]) },
      () => 1000,
    );
    await store.append({ ...event, ...{ token: 'secret', prompt: 'secret' } });
    await store.append({ ...event, mode: 'all', targetPrincipalId: 'other' });
    await store.append({
      ...event,
      principalId: null,
      policyVersions: null,
      mode: null,
      targetPrincipalId: null,
      outcome: 'unavailable',
      count: 0,
    });
    const rows = (
      await db.query<Record<string, unknown>>(
        'SELECT * FROM sso_usage_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.equal(rows.length, 3);
    assert.equal(rows[1]?.mode, 'all');
    assert.equal(rows[1]?.target_principal_id, 'other');
    assert.equal(rows[2]?.principal_id, null);
    assert.equal(String(rows[0]?.occurred_at_ms), '1000');
    assert.doesNotMatch(JSON.stringify(rows), /secret|token|prompt/u);
    await assert.rejects(
      db.exec(
        "INSERT INTO sso_usage_audit_events (occurred_at_ms,request_id,outcome,record_count,principal_id,policy_versions,target_principal_id,mode) VALUES (1,'r','forbidden',1,'a','[]','a','self')",
      ),
    );
  } finally {
    await db.close();
  }
});
test('invalid metadata is rejected before any SQL', async () => {
  let calls = 0;
  const store = createPostgresSsoUsageAuditStore(
    {
      query: async () => {
        calls++;
        return { rows: [{ event_id: '1' }] };
      },
    },
    () => 1,
  );
  const invalid: readonly unknown[] = [
    null,
    [],
    {},
    { ...event, requestId: '' },
    { ...event, requestId: 'a\nb' },
    { ...event, principalId: '' },
    { ...event, policyVersions: null },
    { ...event, policyVersions: [{ id: 'p', version: '' }] },
    { ...event, count: -1 },
    { ...event, count: 0.5 },
    { ...event, count: Number.MAX_SAFE_INTEGER + 1 },
    { ...event, outcome: 'forbidden' },
    { ...event, outcome: 'audit_unavailable' },
    { ...event, mode: 'other' },
    { ...event, mode: null },
    { ...event, targetPrincipalId: 'other' },
    { ...event, principalId: null, policyVersions: null },
    { ...event, outcome: 'unauthenticated', count: 0 },
    { ...event, outcome: 'invalid_query', count: 0 },
  ];
  for (const value of invalid)
    await assert.rejects(store.append(value as SsoUsageAuditEvent), {
      name: 'InvalidSsoUsageAuditEvent',
    });
  assert.equal(calls, 0);
});
test('SQL, clock and malformed acknowledgements fail closed with fixed errors', async () => {
  for (const rows of [
    [],
    [{}],
    [{ event_id: '0' }],
    [{ event_id: 1 }],
    [{ event_id: '1' }, { event_id: '2' }],
    [{ event_id: '-1' }],
  ]) {
    await assert.rejects(
      createPostgresSsoUsageAuditStore({ query: async () => ({ rows }) }, () => 1).append(event),
      { name: 'SsoUsageAuditUnavailable', message: 'SSO usage audit store unavailable' },
    );
  }
  for (const now of [
    () => -1,
    () => NaN,
    () => Infinity,
    () => 0.1,
    () => {
      throw Error('private clock');
    },
  ]) {
    let queried = false;
    await assert.rejects(
      createPostgresSsoUsageAuditStore(
        {
          query: async () => {
            queried = true;
            return { rows: [] };
          },
        },
        now,
      ).append(event),
      { name: 'SsoUsageAuditUnavailable' },
    );
    assert.equal(queried, false);
  }
  await assert.rejects(
    createPostgresSsoUsageAuditStore(
      {
        query: async () => {
          throw Error('private driver');
        },
      },
      () => 1,
    ).append(event),
    { name: 'SsoUsageAuditUnavailable', message: 'SSO usage audit store unavailable' },
  );
});
