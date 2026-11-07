import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createManagementAuditClient } from '../src/management/audit-client.ts';

test('audit client consumes actual loopback API and migrated PGlite, fresh IAM and mandatory audit', async () => {
  const db = new PGlite();
  await db.exec(
    await readFile(new URL('../migrations/003_gateway_audit.sql', import.meta.url), 'utf8'),
  );
  const sql = { query: (text: string, params: readonly unknown[]) => db.query(text, [...params]) };
  const writer = createPostgresGatewayAuditStore(sql, () => 1000);
  const reader = createPostgresAuditHistoryReader(sql);
  const principalId = '팀/개발자:é😀';
  let denied = false;
  let failedAudit = false;
  let reads = 0;
  const unreachable = async (): Promise<never> => {
    throw Error('Unexpected inference');
  };
  const handler = createChatHandler({
    newRequestId: () => 'audit-read-client',
    authenticate: async (token) => {
      assert.equal(token, 'local-test-only');
      return {
        id: 'auditor',
        active: true,
        credentialId: 'test-credential',
        policyVersions: [],
        statements: [
          {
            effect: denied ? 'Deny' : 'Allow',
            actions: ['audit:Read'],
            resources: [`principal:${principalId}`],
          },
        ],
      };
    },
    resolveRoute: unreachable,
    checkLimit: unreachable,
    resolveSecret: unreachable,
    writeUsage: unreachable,
    invokeDirect: unreachable,
    listAudit: async (query) => {
      reads++;
      return reader(query);
    },
    writeAudit: async (value) => {
      if (failedAudit) throw Error('private storage failure');
      await writer.append(value);
    },
  });
  const server = createNodeRequestServer(handler);
  try {
    for (const requestId of ['first', 'second'])
      await writer.append({
        kind: 'models-listed',
        requestId,
        principalId,
        credentialId: 'credential-1',
        policyVersions: [],
        count: 1,
      });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const client = createManagementAuditClient((path, init) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer local-test-only' },
      }),
    );
    const first = await client.list({ principalId, limit: 1 });
    assert.equal(first.state, 'ready');
    if (first.state !== 'ready' || first.data.nextCursor === null) throw Error('Missing page');
    assert.equal(first.data.events[0]?.requestId, 'second');
    const second = await client.list({ principalId, limit: 1, cursor: first.data.nextCursor });
    assert.equal(second.state, 'ready');
    if (second.state === 'ready') {
      assert.equal(second.data.events[0]?.requestId, 'first');
      assert.equal(second.data.nextCursor, null);
    }
    denied = true;
    assert.deepEqual(await client.list({ principalId }), { state: 'denied' });
    assert.equal(reads, 2);
    denied = false;
    failedAudit = true;
    const failed = await client.list({ principalId });
    assert.deepEqual(failed, { state: 'unavailable' });
    assert.equal(JSON.stringify(failed).includes('private storage failure'), false);
    assert.equal(reads, 3);
    client.invalidate();
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await db.close();
  }
});
