import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import {
  createPostgresGatewayAuditStore,
  type GatewayAuditSqlClient,
  GatewayAuditUnavailable,
} from '../src/audit/postgres-gateway-audit.ts';
import { createPostgresSsoAdministrationBrowserServer } from '../src/gateway/postgres-sso-administration-browser-http.ts';
import { createPostgresRfc9068SsoManagementServer } from '../src/gateway/postgres-sso-management-http.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const event = { kind: 'management-auth-denied', operation: 'issue', requestId: 'ack-780' } as const;
const malformed: readonly (readonly [string, unknown])[] = [
  ['null result', null],
  ['inherited rows', Object.create({ rows: [{ event_id: 1 }] })],
  ['non-array rows', { rows: { length: 1, 0: { event_id: 1 } } }],
  ['empty rows', { rows: [] }],
  ['multiple rows', { rows: [{ event_id: 1 }, { event_id: 2 }] }],
  ['sparse rows', { rows: new Array(1) }],
  ['null row', { rows: [null] }],
  ['array row', { rows: [Object.assign([], { event_id: 1 })] }],
  ['missing id', { rows: [{}] }],
  ['inherited id', { rows: [Object.create({ event_id: 1 })] }],
  ...[
    undefined,
    null,
    true,
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '',
    '0',
    '-1',
    '+1',
    '01',
    '1.0',
    '1e2',
    ' 1',
    '1 ',
    '9223372036854775808',
    '9'.repeat(100),
    1n,
  ].map((id) => [String(id), { rows: [{ event_id: id }] }] as const),
];
function client(result: unknown): GatewayAuditSqlClient {
  return { query: async () => result as Awaited<ReturnType<GatewayAuditSqlClient['query']>> };
}
for (const [name, result] of malformed) {
  test('gateway append rejects malformed acknowledgement: ' + name, async () => {
    const store = createPostgresGatewayAuditStore(client(result), () => 1000);
    await assert.rejects(store.append(event), {
      name: 'GatewayAuditUnavailable',
      message: 'Gateway audit store unavailable',
    });
  });
}
for (const eventId of [
  1,
  Number.MAX_SAFE_INTEGER,
  '1',
  '9007199254740993',
  '9223372036854775807',
]) {
  test('gateway append accepts existing driver acknowledgement ' + eventId, async () => {
    await createPostgresGatewayAuditStore(
      client({ rows: [{ event_id: eventId }] }),
      () => 1000,
    ).append(event);
  });
}
test('gateway append waits for acknowledgement and preserves safe query failure', async () => {
  let release: (result: { rows: readonly unknown[] }) => void = () => assert.fail();
  const pending = new Promise<{ rows: readonly unknown[] }>((resolve) => {
    release = resolve;
  });
  let settled = false;
  const append = createPostgresGatewayAuditStore({ query: () => pending }, () => 1000)
    .append(event)
    .then(() => {
      settled = true;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release({ rows: [{ event_id: '1' }] });
  await append;
  assert.equal(settled, true);
  await assert.rejects(
    createPostgresGatewayAuditStore(
      {
        query: async () => {
          throw Error('PRIVATE driver credential');
        },
      },
      () => 1000,
    ).append(event),
    GatewayAuditUnavailable,
  );
});

for (const factory of [
  createPostgresRfc9068SsoManagementServer,
  createPostgresSsoAdministrationBrowserServer,
]) {
  for (const [name, result, status, code] of [
    ['malformed SQL acknowledgement', { rows: [{}] }, 503, 'audit_unavailable'],
    ['valid numeric SQL acknowledgement', { rows: [{ event_id: 1 }] }, 401, 'unauthorized'],
    [
      'valid bigint SQL acknowledgement',
      { rows: [{ event_id: '9223372036854775807' }] },
      401,
      'unauthorized',
    ],
  ] as const) {
    test(factory.name + ' actual HTTP denial requires ' + name, async () => {
      const jwt = await createSsoAccessTokenFixture();
      const queries: string[] = [];
      const server = factory({
        javascript: '// public artifact',
        ...jwt.config,
        newRequestId: () => 'http-780',
        client: {
          query: async (sql) => {
            queries.push(sql);
            return result;
          },
        },
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        for (const path of [
          '/management/v1/me',
          '/management/v1/proxy-tokens',
          '/management/v1/proxy-tokens/revoke',
        ]) {
          const response = await fetch('http://127.0.0.1:' + address.port + path, {
            method: path.endsWith('/me') ? 'GET' : 'POST',
            headers: { authorization: 'Bearer malformed', 'content-type': 'application/json' },
            ...(path.endsWith('/me') ? {} : { body: '{}' }),
          });
          assert.equal(response.status, status);
          assert.equal(response.headers.get('cache-control'), 'no-store');
          const body = await response.text();
          assert.equal(JSON.parse(body).error.code, code);
          assert.ok(!body.includes('malformed') && !body.includes('PRIVATE'));
        }
        assert.equal(queries.length, 3);
        assert.ok(queries.every((sql) => sql.includes('INSERT INTO gateway_audit_events')));
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  }
}
