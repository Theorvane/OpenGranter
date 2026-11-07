import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { parseAuditHistoryQuery } from '../src/audit/history-http.ts';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';

const target = '팀/개발자:é😀';
const decomposed = '팀/개발자:e\u0301😀';

test('audit query retains exact Unicode identity without trimming or normalization', () => {
  for (const principal of [target, decomposed, '  팀 개발자  ', '😀'.repeat(128)]) {
    const url = new URL('http://localhost/v1/audit');
    url.searchParams.set('principal_id', principal);
    assert.equal(parseAuditHistoryQuery(url).requestedPrincipalId, principal);
  }
  for (const principal of [
    '',
    '   ',
    '\t',
    'x\u0000y',
    'x\u001fy',
    'x\u007fy',
    'x\u0085y',
    'x\u009fy',
    '😀'.repeat(129),
  ]) {
    const url = new URL('http://localhost/v1/audit');
    url.searchParams.set('principal_id', principal);
    assert.throws(() => parseAuditHistoryQuery(url), { name: 'InvalidAuditHistoryQuery' });
  }
});

test('real loopback audit JSON/CSV pages retain exact Unicode SQL scope, fresh IAM and required audit', async () => {
  const db = new PGlite();
  await db.exec(
    await readFile(new URL('../migrations/003_gateway_audit.sql', import.meta.url), 'utf8'),
  );
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  const writer = createPostgresGatewayAuditStore(client, () => 1_000);
  const reader = createPostgresAuditHistoryReader(client);
  const policyVersions = [{ id: 'audit-policy', version: 'v1' }];
  let denied = false;
  let failAudit = false;
  let reads = 0;
  let audits = 0;
  const unreachable = async (): Promise<never> => {
    throw new Error('unexpected inference port');
  };
  const handler = createChatHandler({
    newRequestId: () => 'audit-http-request',
    authenticate: async () => ({
      id: 'auditor',
      active: true,
      credentialId: 'auditor-credential',
      policyVersions,
      statements: [
        { effect: 'Allow', actions: ['audit:Read'], resources: ['principal:' + target] },
        ...(denied
          ? [
              {
                effect: 'Deny' as const,
                actions: ['audit:Read'],
                resources: ['principal:' + target],
              },
            ]
          : []),
      ],
    }),
    resolveRoute: unreachable,
    checkLimit: unreachable,
    resolveSecret: unreachable,
    writeUsage: unreachable,
    invokeDirect: unreachable,
    listAudit: async (query) => {
      reads++;
      return reader(query);
    },
    writeAudit: async (event) => {
      audits++;
      if (failAudit) throw new Error('private storage failure');
      await writer.append(event);
    },
  });
  const server = createNodeRequestServer(handler);
  try {
    for (const [principalId, requestId] of [
      [target, 'target-first'],
      [decomposed, 'not-normalized'],
      [target, 'target-second'],
    ] as const) {
      await writer.append({
        kind: 'models-listed',
        requestId,
        principalId,
        credentialId: 'credential-1',
        policyVersions,
        count: 1,
      });
    }
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const get = (principalId: string, extra = '') =>
      fetch(
        `http://127.0.0.1:${address.port}/v1/audit?${new URLSearchParams({ principal_id: principalId, limit: '1' })}${extra}`,
        { headers: { authorization: 'Bearer local-test-token' } },
      );
    const first = await get(target);
    assert.equal(first.status, 200);
    const firstPage = (await first.json()) as {
      data: { requestId: string; principalId: string }[];
      next_cursor: string;
    };
    assert.deepEqual(
      firstPage.data.map((row) => [row.requestId, row.principalId]),
      [['target-second', target]],
    );
    assert.equal(typeof firstPage.next_cursor, 'string');
    const second = await get(
      target,
      '&cursor=' + encodeURIComponent(firstPage.next_cursor) + '&format=csv',
    );
    assert.equal(second.status, 200);
    assert.match(second.headers.get('content-type') ?? '', /text\/csv/u);
    const csv = await second.text();
    assert.ok(csv.includes('target-first'));
    assert.ok(csv.includes(target));
    assert.equal(csv.includes('not-normalized'), false);
    assert.equal(csv.includes('target-second'), false);
    assert.equal((await get(decomposed)).status, 403);
    assert.equal((await get(target + '\u0085')).status, 400);
    assert.equal(reads, 2);
    denied = true;
    assert.equal((await get(target)).status, 403);
    assert.equal(reads, 2);
    denied = false;
    failAudit = true;
    const failed = await get(target);
    assert.equal(failed.status, 503);
    const text = await failed.text();
    assert.equal(text.includes(target), false);
    assert.equal(text.includes('target-second'), false);
    assert.equal(text.includes('private storage failure'), false);
    assert.equal(reads, 3);
    assert.ok(audits >= 5);
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await db.close();
  }
});

test('audit principal projection is exact while other identifier grammars stay restricted', async () => {
  const calls: unknown[] = [];
  const writer = createPostgresGatewayAuditStore(
    {
      query: async (_sql, params) => {
        calls.push(params);
        return { rows: [{ event_id: 1 }] };
      },
    },
    () => 1_000,
  );
  const base = {
    kind: 'models-listed' as const,
    requestId: 'request-1',
    principalId: target,
    credentialId: 'credential-1',
    policyVersions: [{ id: 'policy', version: 'v1' }],
    count: 1,
  };
  await writer.append(base);
  await writer.append({ ...base, kind: 'audit-history-read', targetPrincipalId: decomposed });
  assert.equal((calls[0] as unknown[])[3], target);
  assert.equal((calls[1] as unknown[])[3], target);
  assert.equal(
    (calls[1] as unknown[])[6],
    JSON.stringify({ targetPrincipalId: decomposed, count: 1 }),
  );
  for (const principalId of [
    '',
    '   ',
    'x\u0000y',
    'x\u001fy',
    'x\u007fy',
    'x\u0085y',
    'x\u009fy',
    '😀'.repeat(129),
  ]) {
    await assert.rejects(writer.append({ ...base, principalId }), {
      name: 'InvalidGatewayAuditEvent',
    });
    await assert.rejects(
      writer.append({ ...base, kind: 'audit-history-read', targetPrincipalId: principalId }),
      { name: 'InvalidGatewayAuditEvent' },
    );
    await assert.rejects(
      createPostgresAuditHistoryReader({
        query: async () => {
          throw new Error('must not query');
        },
      })({ principalId, limit: 1 }),
      { name: 'AuditHistoryUnavailable' },
    );
  }
  for (const extra of [
    { requestId: target },
    { credentialId: target },
    { policyVersions: [{ id: target, version: 'v1' }] },
  ]) {
    await assert.rejects(writer.append({ ...base, ...extra }), {
      name: 'InvalidGatewayAuditEvent',
    });
  }
  assert.equal(calls.length, 2);
});
