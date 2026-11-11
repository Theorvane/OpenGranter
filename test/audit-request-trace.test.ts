import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../src/audit/history-http.ts';
import {
  type AuditHistoryQuery,
  createPostgresAuditHistoryReader,
} from '../src/audit/postgres-audit-history.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';

const migration = await readFile(
  new URL('../migrations/003_gateway_audit.sql', import.meta.url),
  'utf8',
);
const target = 'trace+run:/@-1';
const row = {
  event_id: '8',
  occurred_at_ms: '100',
  kind: 'models-listed',
  request_id: target,
  principal_id: 'human',
  credential_id: 'cred',
  policy_versions: [{ id: 'p', version: '1' }],
  details: { count: 1 },
};
const event = {
  eventId: '8',
  occurredAt: 100,
  kind: row.kind,
  requestId: target,
  principalId: 'human',
  credentialId: 'cred',
  policyVersions: row.policy_versions,
  details: row.details,
};

test('audit request parser accepts exact identifiers and rejects malformed/duplicate values', () => {
  for (const id of [target, 'A', 'x'.repeat(256)]) {
    assert.equal(
      parseAuditHistoryQuery(new URL('https://local/v1/audit?request_id=' + encodeURIComponent(id)))
        .requestId,
      id,
    );
  }
  for (const query of [
    'request_id=',
    'request_id=a&request_id=a',
    'request_id=a+b',
    'request_id=%00',
    'request_id=é',
    'request_id=' + 'x'.repeat(257),
    'request_id=%27%20OR%20true',
  ]) {
    assert.throws(() => parseAuditHistoryQuery(new URL('https://local/v1/audit?' + query)), {
      name: 'InvalidAuditHistoryQuery',
    });
  }
});

test('real migrated SQL intersects exact request with scope/time/model/keyset', async () => {
  const db = new PGlite();
  try {
    await db.exec(migration);
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const client = {
      query: async (sql: string, params: readonly unknown[]) => {
        calls.push({ sql, params });
        return db.query(sql, [...params]);
      },
    };
    const writer = createPostgresGatewayAuditStore(client, () => 100);
    for (const [principalId, requestId] of [
      ['human', target],
      ['human', 'other'],
      ['human', target],
      ['foreign', target],
      ['human', target.toUpperCase()],
    ] as const) {
      await writer.append({
        kind: 'route-unavailable',
        requestId,
        principalId,
        credentialId: 'cred',
        policyVersions: [{ id: 'p', version: '1' }],
        modelAlias: 'model',
      });
    }
    const reader = createPostgresAuditHistoryReader(client);
    const query = {
      principalId: 'human',
      requestId: target,
      modelAlias: 'model',
      fromMs: 100,
      toMs: 101,
      limit: 1,
    };
    const first = await reader(query);
    assert.deepEqual(
      first.events.map((e) => e.eventId),
      ['3'],
    );
    assert.equal(first.nextCursor, '3');
    const second = await reader({ ...query, cursor: first.nextCursor });
    assert.deepEqual(
      second.events.map((e) => e.eventId),
      ['1'],
    );
    assert.equal(second.nextCursor, null);
    assert.deepEqual((await reader({ ...query, requestId: 'absent' })).events, []);
    assert.deepEqual((await reader({ ...query, modelAlias: 'absent' })).events, []);
    assert.deepEqual((await reader({ ...query, fromMs: 101, toMs: 102 })).events, []);
    const select = calls.find((c) => c.sql.includes('FROM gateway_audit_events'));
    assert.ok(select);
    assert.match(select.sql, /request_id = \$7::text/u);
    assert.equal(select.sql.includes(target), false);
    assert.equal(select.params[6], target);
  } finally {
    await db.close();
  }
});

test('audit request lookahead and injected projections fail closed', async () => {
  for (const rows of [
    [{ ...row, request_id: 'wrong' }],
    [row, { ...row, event_id: '7', request_id: 'wrong' }],
  ]) {
    const reader = createPostgresAuditHistoryReader({ query: async () => ({ rows }) });
    await assert.rejects(reader({ principalId: 'human', requestId: target, limit: 1 }), {
      name: 'AuditHistoryUnavailable',
    });
  }
  assert.throws(() =>
    projectAuditHistoryPage(
      { events: [{ ...event, requestId: 'wrong' }], nextCursor: null },
      'human',
      1,
      null,
      { requestId: target },
    ),
  );
});

test('reader owns scope/filter/page snapshot across SQL suspension', async () => {
  const query = {
    principalId: 'human',
    requestId: target,
    fromMs: 100,
    toMs: 101,
    limit: 1,
    cursor: '9',
  };
  let resume!: () => void;
  const suspended = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const reader = createPostgresAuditHistoryReader({
    query: async () => {
      await suspended;
      return { rows: [row, { ...row, event_id: '7' }] };
    },
  });
  const pending = reader(query);
  Object.assign(query, {
    principalId: 'foreign',
    requestId: 'wrong',
    fromMs: 999,
    toMs: 1000,
    limit: 100,
    cursor: '1',
  });
  resume();
  const page = await pending;
  assert.equal(page.events.length, 1);
  assert.equal(page.nextCursor, '8');
  assert.equal(page.events[0]?.principalId, 'human');
});

test('malformed reader filters fail before SQL', async () => {
  let calls = 0;
  const reader = createPostgresAuditHistoryReader({
    query: async () => {
      calls++;
      return { rows: [] };
    },
  });
  for (const requestId of ['', 'has space', 'é', 'x'.repeat(257), null, 1]) {
    await assert.rejects(
      reader({ principalId: 'human', limit: 1, requestId } as AuditHistoryQuery),
    );
  }
  assert.equal(calls, 0);
});
