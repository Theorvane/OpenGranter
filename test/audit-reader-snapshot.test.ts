import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  type AuditHistoryQuery,
  AuditHistoryUnavailable,
  createPostgresAuditHistoryReader,
} from '../src/audit/postgres-audit-history.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';

function row(eventId = '9') {
  return {
    event_id: eventId,
    occurred_at_ms: '1000',
    kind: 'route-unavailable',
    request_id: 'request-a',
    principal_id: 'human-a',
    credential_id: 'credential-a',
    policy_versions: [{ id: 'allow', version: 'v1' }],
    details: { modelAlias: 'team/chat' },
  };
}
function query() {
  return {
    principalId: 'human-a',
    limit: 1,
    cursor: '10',
    modelAlias: 'team/chat',
    requestId: 'request-a',
    fromMs: 500,
    toMs: 1500,
  };
}
function pending() {
  let release!: (value: { rows: unknown[] }) => void;
  const waiting = new Promise<{ rows: unknown[] }>((resolve) => {
    release = resolve;
  });
  let parameters: readonly unknown[] | undefined;
  const reader = createPostgresAuditHistoryReader({
    query: async (_sql, params) => {
      parameters = [...params];
      return waiting;
    },
  });
  return { reader, release, parameters: () => parameters };
}

for (const [field, replacement] of [
  ['principalId', 'human-b'],
  ['modelAlias', 'other'],
  ['requestId', 'request-b'],
  ['fromMs', 1001],
  ['toMs', 1000],
  ['cursor', '1'],
  ['limit', 2],
] as const) {
  test(`pending audit read retains original ${field}`, async () => {
    const f = pending();
    const input = query();
    const result = f.reader(input);
    Object.assign(input, { [field]: replacement });
    f.release({ rows: [row(), row('8')] });
    const page = await result;
    assert.deepEqual(f.parameters(), ['human-a', '10', 2, 500, 1500, 'team/chat', 'request-a']);
    assert.deepEqual(
      page.events.map((event) => event.eventId),
      ['9'],
    );
    assert.equal(page.nextCursor, '9');
  });
}

test('changed caller scope cannot legitimize substituted foreign audit rows', async () => {
  const f = pending();
  const input = query();
  const result = f.reader(input);
  Object.assign(input, {
    principalId: 'human-b',
    modelAlias: 'other',
    requestId: 'request-b',
    fromMs: 2000,
    toMs: 3000,
  });
  f.release({
    rows: [
      {
        ...row(),
        principal_id: 'human-b',
        request_id: 'request-b',
        occurred_at_ms: '2500',
        details: { modelAlias: 'other' },
      },
    ],
  });
  await assert.rejects(result, AuditHistoryUnavailable);
});

test('caller widening page limit cannot authorize excess SQL rows', async () => {
  const f = pending();
  const input = query();
  const result = f.reader(input);
  input.limit = 100;
  f.release({ rows: [row(), row('8'), row('7')] });
  await assert.rejects(result, AuditHistoryUnavailable);
});

test('concurrent persisted audit reads keep independent original principals', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/003_gateway_audit.sql', import.meta.url), 'utf8'),
    );
    const sql = {
      query: (text: string, params: readonly unknown[]) => db.query(text, [...params]),
    };
    const writer = createPostgresGatewayAuditStore(sql, () => 1000);
    for (const principalId of ['human-a', 'human-b']) {
      for (const requestId of ['one', 'two'])
        await writer.append({
          kind: 'models-listed',
          requestId,
          principalId,
          credentialId: 'credential-a',
          policyVersions: [{ id: 'allow', version: 'v1' }],
          count: 1,
        });
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = createPostgresAuditHistoryReader({
      query: async (text, params) => {
        await gate;
        return sql.query(text, params);
      },
    });
    const first: AuditHistoryQuery = { principalId: 'human-a', limit: 1 };
    const second: AuditHistoryQuery = { principalId: 'human-b', limit: 1 };
    const a = reader(first);
    const b = reader(second);
    Object.assign(first, { principalId: 'human-b', limit: 100 });
    Object.assign(second, { principalId: 'human-a', limit: 100 });
    release();
    const pages = await Promise.all([a, b]);
    assert.deepEqual(
      pages.map((page) => page.events.map((event) => event.principalId)),
      [['human-a'], ['human-b']],
    );
    assert.deepEqual(
      pages.map((page) => page.nextCursor),
      ['2', '4'],
    );
  } finally {
    await db.close();
  }
});

test('unchanged original audit scope accepts valid rows', async () => {
  const f = pending();
  const result = f.reader(query());
  f.release({ rows: [row(), row('8')] });
  const page = await result;
  assert.deepEqual(
    page.events.map((event) => event.eventId),
    ['9'],
  );
  assert.equal(page.nextCursor, '9');
});
