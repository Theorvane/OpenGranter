import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import {
  createPostgresGatewayAuditStore,
  type GatewayAuditInput,
  projectGatewayAuditEvent,
} from '../src/audit/postgres-gateway-audit.ts';

const attribution = {
  requestId: 'request',
  principalId: 'user',
  credentialId: 'credential',
  policyVersions: [],
};
test('single-model audit retains only visible count 0/1 and no unavailable details', () => {
  for (const count of [0, 1]) {
    const row = projectGatewayAuditEvent(
      {
        ...attribution,
        kind: 'model-read',
        count,
        modelAlias: 'private-requested',
        path: 'private-path',
        pricing: 'private-price',
        token: 'private-token',
      },
      1000,
    );
    assert.equal(row.kind, 'model-read');
    assert.deepEqual(row.details, { count });
    assert.doesNotMatch(JSON.stringify(row), /private-/u);
  }
  const unavailable = projectGatewayAuditEvent(
    { ...attribution, kind: 'model-read-unavailable', modelAlias: 'private-requested' },
    1000,
  );
  assert.deepEqual(unavailable.details, {});
  assert.doesNotMatch(JSON.stringify(unavailable), /private-/u);
});
test('single-model audit rejects invalid result counts and exposes safe storage failures', async () => {
  for (const count of [-1, 2, NaN, Infinity, 0.5, undefined, '1'])
    assert.throws(
      () => projectGatewayAuditEvent({ ...attribution, kind: 'model-read', count }, 1000),
      { name: 'InvalidGatewayAuditEvent', message: 'Invalid gateway audit event' },
    );
  const store = createPostgresGatewayAuditStore(
    {
      query: async () => {
        throw Error('private-driver');
      },
    },
    () => 1000,
  );
  await assert.rejects(
    store.append({ ...attribution, kind: 'model-read', count: 1 } as GatewayAuditInput),
    { name: 'GatewayAuditUnavailable', message: 'Gateway audit store unavailable' },
  );
});
test('migrated audit store and principal-scoped history preserve single-model reads privately', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/003_gateway_audit.sql', import.meta.url), 'utf8'),
    );
    const client = {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const store = createPostgresGatewayAuditStore(client, () => 1000);
    for (const input of [
      { ...attribution, kind: 'model-read', count: 1, prompt: 'private-content' },
      { ...attribution, kind: 'model-read', count: 0 },
      { ...attribution, kind: 'model-read-unavailable', path: 'private-path' },
      { ...attribution, kind: 'model-read', principalId: 'other', count: 1 },
    ])
      await store.append(input as GatewayAuditInput);
    const page = await createPostgresAuditHistoryReader(client)({ principalId: 'user', limit: 10 });
    assert.deepEqual(
      page.events.map((row) => ({ kind: row.kind, details: row.details })),
      [
        { kind: 'model-read-unavailable', details: {} },
        { kind: 'model-read', details: { count: 0 } },
        { kind: 'model-read', details: { count: 1 } },
      ],
    );
    assert.ok(page.events.every((row) => row.principalId === 'user'));
    assert.doesNotMatch(JSON.stringify(page), /private-/u);
  } finally {
    await db.close();
  }
});
