import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { projectAuditHistoryPage } from '../src/audit/history-http.ts';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import {
  createPostgresGatewayAuditStore,
  type GatewayAuditInput,
} from '../src/audit/postgres-gateway-audit.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';

// Captured from invokeOwnedRoute at PR #1007 head 7a494e20e5fbb2df6b8bc6c7a1f7e6636e4ace04.
const started = {
  principalId: 'person-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'allow', version: 'v1' }],
  requestId: 'owned-request-1',
  routeVersion: 'route-v1',
  modelAlias: 'chat',
  kind: 'owned-selection-started' as const,
  candidateIds: ['candidate-1'],
};
const { candidateIds: _candidateIds, ...base } = started;
const selection = {
  ...base,
  kind: 'owned-selection',
  candidateId: 'candidate-1',
  selection: 'strategy',
  strategy: 'administrator-priority',
};
const denied = { ...base, kind: 'owned-denied', reason: 'no-candidates' };
const inputs = [started, selection, denied];
const migration = await readFile(
  new URL('../migrations/003_gateway_audit.sql', import.meta.url),
  'utf8',
);

test('owned read projection rejects detail fields that collide with attribution', async () => {
  for (const key of ['kind', 'requestId', 'principalId', 'credentialId', 'policyVersions']) {
    const details = {
      routeVersion: started.routeVersion,
      modelAlias: started.modelAlias,
      candidateIds: started.candidateIds,
      [key]: 'private',
    };
    const reader = createPostgresAuditHistoryReader({
      query: async () => ({
        rows: [
          {
            event_id: '1',
            occurred_at_ms: '1000',
            kind: started.kind,
            request_id: started.requestId,
            principal_id: started.principalId,
            credential_id: started.credentialId,
            policy_versions: started.policyVersions,
            details,
          },
        ],
      }),
    });
    await assert.rejects(reader({ principalId: started.principalId, limit: 1 }), {
      name: 'AuditHistoryUnavailable',
    });
    assert.throws(() =>
      projectAuditHistoryPage(
        { events: [{ ...started, eventId: '1', occurredAt: 1000, details }], nextCursor: null },
        started.principalId,
        1,
        null,
      ),
    );
  }
});

test('genuine owned core event crosses public append and existing SQL history boundary', async () => {
  const db = new PGlite();
  try {
    await db.exec(migration);
    const client = {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const store = createPostgresGatewayAuditStore(client, () => 1000);
    for (const event of inputs) await store.append(event as GatewayAuditInput);
    const page = await createPostgresAuditHistoryReader(client)({
      principalId: 'person-1',
      limit: 10,
    });
    assert.deepEqual(
      page.events.map((e) => e.kind),
      ['owned-denied', 'owned-selection', 'owned-selection-started'],
    );
    assert.deepEqual(
      page.events.map((e) => e.details),
      [
        { routeVersion: 'route-v1', modelAlias: 'chat', reason: 'no-candidates' },
        {
          routeVersion: 'route-v1',
          modelAlias: 'chat',
          candidateId: 'candidate-1',
          selection: 'strategy',
          strategy: 'administrator-priority',
        },
        { routeVersion: 'route-v1', modelAlias: 'chat', candidateIds: ['candidate-1'] },
      ],
    );
    assert.ok(
      page.events.every(
        (e) => e.credentialId === started.credentialId && e.requestId === started.requestId,
      ),
    );
    assert.deepEqual(page.events[0]?.policyVersions, started.policyVersions);
    assert.deepEqual(
      (await createPostgresAuditHistoryReader(client)({ principalId: 'person-2', limit: 10 }))
        .events,
      [],
    );
  } finally {
    await db.close();
  }
});

test('owned append rejects unknown or malformed fields before SQL', async () => {
  let queries = 0;
  const store = createPostgresGatewayAuditStore(
    {
      query: async () => {
        queries++;
        return { rows: [{ event_id: '1' }] };
      },
    },
    () => 1000,
  );
  const malformed: unknown[] = [
    ...['prompt', 'response', 'providerKey', 'credentialRef', 'rawJevResponse', 'metadata'].flatMap(
      (key) => inputs.map((event) => ({ ...event, [key]: 'private' })),
    ),
    { ...started, kind: 'owned-unknown' },
    { ...started, candidateIds: [] },
    { ...started, candidateIds: ['candidate-1', 'candidate-1'] },
    { ...started, candidateIds: Array(1) },
    { ...started, candidateIds: Array(1025).fill('candidate') },
    { ...started, candidateIds: [null] },
    { ...started, candidateIds: Object.assign(['candidate-1'], { metadata: 'private' }) },
    { ...started, policyVersions: Object.assign([], { metadata: 'private' }) },
    {
      ...started,
      policyVersions: Object.setPrototypeOf([], {
        ...Array.prototype,
        map: () => [{ secret: 'private' }],
      }),
    },
    { ...started, candidateIds: ['bad space'] },
    { ...started, candidateId: 'candidate-1' },
    { ...started, reason: 'no-candidates' },
    { ...started, principalId: '' },
    { ...started, credentialId: null },
    { ...started, policyVersions: [{ id: 'allow', version: 'v1', secret: 'private' }] },
    { ...started, policyVersions: Array(1) },
    { ...started, policyVersions: [{ id: 'allow' }] },
    { ...selection, candidateId: undefined },
    { ...selection, selection: 'arbitrary' },
    { ...selection, strategy: 'raw-custom-strategy-id' },
    { ...selection, candidateIds: ['candidate-1'] },
    { ...denied, reason: 'limit' },
    { ...denied, reason: undefined },
    { ...denied, strategy: 'custom' },
    Object.assign(Object.create(started), { kind: started.kind }),
    { ...started, [Symbol('private')]: 'private' },
    Object.defineProperty({ ...started }, 'prompt', { value: 'private', enumerable: false }),
    Object.defineProperty({ ...started }, 'candidateIds', {
      get() {
        throw new Error('private');
      },
    }),
    Object.defineProperty({ ...started }, 'kind', {
      get() {
        throw new Error('private');
      },
    }),
  ];
  for (const event of malformed)
    await assert.rejects(store.append(event as GatewayAuditInput), {
      name: 'InvalidGatewayAuditEvent',
      message: 'Invalid gateway audit event',
    });
  assert.equal(queries, 0);
});

test('owned SQL history survives reopening and rejects corrupted stored metadata', async () => {
  const path = await mkdtemp(join(tmpdir(), 'owned-audit-'));
  let db = new PGlite(path);
  try {
    await db.exec(migration);
    await createPostgresGatewayAuditStore(
      { query: (sql, params) => db.query(sql, [...params]) },
      () => 1000,
    ).append(started);
    await db.close();
    db = new PGlite(path);
    const reader = createPostgresAuditHistoryReader({
      query: (sql, params) => db.query(sql, [...params]),
    });
    const page = await reader({
      principalId: 'person-1',
      requestId: started.requestId,
      modelAlias: 'chat',
      limit: 1,
    });
    assert.equal(page.events[0]?.kind, started.kind);
    await db.exec(
      `UPDATE gateway_audit_events SET details = details || '{"metadata":"private"}'::jsonb`,
    );
    await assert.rejects(reader({ principalId: 'person-1', limit: 1 }), {
      name: 'AuditHistoryUnavailable',
      message: 'Audit history unavailable',
    });
    await db.exec('DROP TABLE gateway_audit_events');
    await assert.rejects(reader({ principalId: 'person-1', limit: 1 }), {
      name: 'AuditHistoryUnavailable',
      message: 'Audit history unavailable',
    });
  } finally {
    await db.close();
    await rm(path, { recursive: true, force: true });
  }
});

test('owned enum variants and bounded candidate arrays persist with safe SQL failure barriers', async () => {
  let queries = 0;
  const store = createPostgresGatewayAuditStore(
    {
      query: async () => {
        queries++;
        return { rows: [{ event_id: '1' }] };
      },
    },
    () => 1000,
  );
  for (const reason of ['no-candidates', 'configuration', 'reservation'])
    await store.append({ ...denied, reason } as GatewayAuditInput);
  for (const strategy of ['administrator-priority', 'jev-research', 'custom'])
    for (const source of ['strategy', 'deterministic-fallback'])
      await store.append({ ...selection, strategy, selection: source } as GatewayAuditInput);
  await store.append({
    ...started,
    candidateIds: Array.from({ length: 1024 }, (_, i) => `c-${i}`),
  } as GatewayAuditInput);
  assert.equal(queries, 10);
  for (const query of [
    async () => {
      throw new Error('private database error');
    },
    async () => ({ rows: [] }),
  ]) {
    const broken = createPostgresGatewayAuditStore({ query }, () => 1000);
    for (const event of inputs)
      await assert.rejects(broken.append(event as GatewayAuditInput), {
        name: 'GatewayAuditUnavailable',
        message: 'Gateway audit store unavailable',
      });
  }
});

test('owned history preserves required target-principal permission and read audit', async () => {
  const historyEvent = {
    eventId: '1',
    occurredAt: 1000,
    ...started,
    details: { routeVersion: 'route-v1', modelAlias: 'chat', candidateIds: ['candidate-1'] },
  };
  for (const granted of [true, false]) {
    let reads = 0;
    const audits: string[] = [];
    const handler = createChatHandler({
      newRequestId: () => 'history-1',
      authenticate: async () => ({
        id: 'person-1',
        active: true,
        credentialId: 'credential-1',
        policyVersions: started.policyVersions,
        statements: granted
          ? [{ effect: 'Allow', actions: ['audit:Read'], resources: ['principal:person-1'] }]
          : [],
      }),
      resolveRoute: async () => {
        throw new Error('unexpected');
      },
      checkLimit: async () => {
        throw new Error('unexpected');
      },
      resolveSecret: async () => {
        throw new Error('unexpected');
      },
      writeUsage: async () => {
        throw new Error('unexpected');
      },
      invokeDirect: async () => {
        throw new Error('unexpected');
      },
      writeAudit: async (event) => {
        audits.push(event.kind);
      },
      listAudit: async () => {
        reads++;
        return { events: [historyEvent], nextCursor: null };
      },
    });
    const response = await handler(
      new Request('http://localhost/v1/audit', { headers: { authorization: 'Bearer fixture' } }),
    );
    assert.equal(response.status, granted ? 200 : 403);
    assert.equal(reads, granted ? 1 : 0);
    assert.deepEqual(audits, [granted ? 'audit-history-read' : 'audit-history-read-denied']);
    if (granted) {
      const body = (await response.json()) as { data: { kind: string }[] };
      assert.equal(body.data[0]?.kind, started.kind);
    }
  }
});
