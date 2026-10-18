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

const event = {
  kind: 'models-counted',
  requestId: 'request',
  principalId: 'user',
  credentialId: 'credential',
  policyVersions: [],
  count: 4,
};
test('models-counted projection retains only safe visible count and attribution', () => {
  const projected = projectGatewayAuditEvent(
    {
      ...event,
      prompt: 'private-input',
      token: 'private-token',
      output_modalities: 'private-filter',
    },
    1000,
  );
  assert.equal(projected.kind, 'models-counted');
  assert.deepEqual(projected.details, { count: 4 });
  assert.doesNotMatch(JSON.stringify(projected), /private-/u);
});
test('models-counted rejects invalid count values and safe storage failures', async () => {
  for (const count of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, undefined, '4'])
    assert.throws(() => projectGatewayAuditEvent({ ...event, count }, 1000), {
      name: 'InvalidGatewayAuditEvent',
      message: 'Invalid gateway audit event',
    });
  const store = createPostgresGatewayAuditStore(
    {
      query: async () => {
        throw Error('private-driver');
      },
    },
    () => 1000,
  );
  await assert.rejects(store.append(event as GatewayAuditInput), {
    name: 'GatewayAuditUnavailable',
    message: 'Gateway audit store unavailable',
  });
});
test('models-counted persists in migrated PostgreSQL audit and principal-scoped history', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/003_gateway_audit.sql', import.meta.url), 'utf8'),
    );
    const client = {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const store = createPostgresGatewayAuditStore(client, () => 1000);
    const reader = createPostgresAuditHistoryReader(client);
    await store.append({ ...event, prompt: 'private-input' } as unknown as GatewayAuditInput);
    await store.append({ ...event, principalId: 'other', count: 99 } as GatewayAuditInput);
    await store.append({ ...event, requestId: 'zero', count: 0 } as GatewayAuditInput);
    const page = await reader({ principalId: 'user', limit: 10 });
    assert.deepEqual(
      page.events.map((row) => ({ kind: row.kind, details: row.details })),
      [
        { kind: 'models-counted', details: { count: 0 } },
        { kind: 'models-counted', details: { count: 4 } },
      ],
    );
    assert.ok(page.events.every((row) => row.principalId === 'user'));
    assert.doesNotMatch(JSON.stringify(page), /private-input/u);
  } finally {
    await db.close();
  }
});
