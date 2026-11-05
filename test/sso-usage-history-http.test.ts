import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoUsageHistoryServer } from '../src/gateway/postgres-sso-usage-history-http.ts';
import { createSsoUsageHistoryHandler } from '../src/gateway/sso-usage-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('real loopback HTTP scopes pages/CSV, audits access, refreshes IAM and fails closed', async () => {
  const db = new PGlite();
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  let id = 0;
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  const server = createPostgresSsoUsageHistoryServer({
    ...jwt.config,
    client,
    newRequestId: () => `http-${++id}`,
  });
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(
      await readFile(new URL('../contracts/sso-usage-audit-schema.sql', import.meta.url), 'utf8'),
    );
    await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true);
      INSERT INTO iam_policies VALUES ('p','v1','[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
      INSERT INTO iam_roles VALUES ('reader'); INSERT INTO iam_principal_roles VALUES ('human','reader'); INSERT INTO iam_role_policies VALUES ('reader','p');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const append = createPostgresUsageLedger(client);
    for (const [attemptId, principalId, occurredAt] of [
      ['one', 'human', 1],
      ['two', 'human', 2],
      ['hidden', 'other', 3],
    ] as const) {
      await append(
        buildUsageRecord({
          principalId,
          credentialId: 'original-credential',
          policyVersions: [],
          requestId: `chat-${attemptId}`,
          attemptId,
          modelAlias: 'chat',
          routeKind: 'managed',
          upstreamModelId: 'model',
          selectedCandidateId: 'candidate',
          occurredAt,
          latencyMs: 1,
          outcome: 'succeeded',
          possiblyBilled: true,
          possibleDuplicate: false,
        }),
      );
    }
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('missing address');
    const base = `http://127.0.0.1:${address.port}/management/v1/usage`;
    const get = (query = '', authorization = `Bearer ${token}`) =>
      fetch(`${base}${query}`, {
        headers: { authorization, 'x-request-id': 'untrusted', cookie: 'session=untrusted' },
      });
    const first = await get('?limit=1');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
    const page = (await first.json()) as {
      data: { attemptId: string }[];
      has_more: boolean;
      next_cursor: string;
    };
    assert.equal(page.data[0]?.attemptId, 'two');
    assert.equal(page.has_more, true);
    assert.equal(first.headers.get('x-usage-next-cursor'), page.next_cursor);
    const second = await get(`?limit=1&cursor=${encodeURIComponent(page.next_cursor)}`);
    const last = (await second.json()) as {
      data: { attemptId: string }[];
      has_more: boolean;
      next_cursor: null;
    };
    assert.equal(last.data[0]?.attemptId, 'one');
    assert.equal(last.has_more, false);
    assert.equal(last.next_cursor, null);
    const empty = await get('?model=missing');
    assert.equal(empty.status, 200);
    assert.deepEqual(((await empty.json()) as { data: unknown[] }).data, []);
    const csv = await get('?format=csv&limit=1');
    assert.equal(csv.status, 200);
    assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="usage.csv"');
    const text = await csv.text();
    assert.match(text, /attempt_id/);
    assert.match(text, /two/);
    assert.equal(text.includes('hidden'), false);
    for (const query of ['?principal_id=other', '?principal_id=human']) {
      const denied = await get(query);
      assert.equal(denied.status, 403);
      await denied.text();
    }
    for (const query of ['?limit=0', '?limit=1&limit=2', '?unknown=x']) {
      const bad = await get(query);
      assert.equal(bad.status, 400);
      await bad.text();
    }
    for (const authorization of [
      '',
      'Bearer invalid',
      'Basic invalid',
      `Bearer ${await jwt.token({ exp: jwt.nowSeconds - 3600 })}`,
    ]) {
      const denied = await get('', authorization);
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get('www-authenticate'), 'Bearer');
      await denied.text();
    }
    const rows = (
      await db.query<{ outcome: string; request_id: string }>(
        'SELECT outcome,request_id FROM sso_usage_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.equal(rows.length, 13);
    assert.equal(rows[0]?.request_id, 'http-1');
    assert.deepEqual(
      rows.slice(-4).map((row) => row.outcome),
      Array(4).fill('unauthenticated'),
    );
    await db.exec(
      'UPDATE iam_policies SET statements=\'[{"effect":"Deny","actions":["usage:ReadSelf"],"resources":["principal:human"]}]\'',
    );
    const revoked = await get();
    assert.equal(revoked.status, 403);
    await revoked.text();
    await db.exec(
      'UPDATE iam_policies SET statements=\'[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]\'',
    );
    await db.exec(
      'UPDATE iam_policies SET statements=\'[{"effect":"Allow","actions":["usage:ReadAll"],"resources":["principal:other"]}]\'',
    );
    const all = await get('?principal_id=other');
    assert.equal(all.status, 200);
    assert.equal(
      ((await all.json()) as { data: { attemptId: string }[] }).data[0]?.attemptId,
      'hidden',
    );
    await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human'");
    const inactive = await get('?principal_id=other');
    assert.equal(inactive.status, 401);
    await inactive.text();
    await db.exec("UPDATE iam_principals SET active=true WHERE principal_id='human'");
    await db.exec(
      'UPDATE iam_policies SET statements=\'[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]\'',
    );
    const filtered = await get('?from_ms=1&to_ms=2');
    assert.equal(filtered.status, 200);
    assert.deepEqual(
      ((await filtered.json()) as { data: { attemptId: string }[] }).data.map(
        (row) => row.attemptId,
      ),
      ['one'],
    );
    await db.exec('DROP TABLE sso_usage_audit_events');
    for (const query of ['', '?format=csv']) {
      const failed = await get(query);
      assert.equal(failed.status, 503);
      const error = await failed.text();
      assert.match(error, /audit_unavailable/);
      assert.equal(error.includes('chat-two'), false);
      assert.equal(error.includes(token), false);
    }
  } finally {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await db.close();
  }
});

test('transport guards and fixed failures cannot expose caller or exception content', async () => {
  let calls = 0;
  const handler = createSsoUsageHistoryHandler({
    newRequestId: () => 'trusted',
    usage: {
      read: async () => {
        calls++;
        throw Error('private database detail');
      },
    },
  });
  for (const request of [
    new Request('http://local/other'),
    new Request('http://local/management/v1/usage', { method: 'POST' }),
  ])
    assert.equal((await handler(request)).status, 404);
  const framed = new Request('http://local/management/v1/usage', {
    headers: { 'content-length': '1' },
  });
  assert.equal((await handler(framed)).status, 400);
  assert.equal(calls, 0);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await handler(new Request('http://local/management/v1/usage', { signal: controller.signal })))
      .status,
    400,
  );
  const failure = await handler(
    new Request('http://local/management/v1/usage', { headers: { authorization: 'Bearer test' } }),
  );
  assert.equal(failure.status, 503);
  assert.equal((await failure.text()).includes('private'), false);
  const invalidId = createSsoUsageHistoryHandler({
    newRequestId: () => '\ninvalid',
    usage: {
      read: async () => {
        throw Error('must not call');
      },
    },
  });
  assert.equal((await invalidId(new Request('http://local/management/v1/usage'))).status, 503);
});

test('service outcomes, paging guards and anonymous success fail closed', async () => {
  const request = () =>
    new Request('http://local/management/v1/usage', { headers: { authorization: 'Bearer test' } });
  for (const [state, status, code] of [
    ['unauthenticated', 401, 'unauthorized'],
    ['forbidden', 403, 'forbidden'],
    ['invalid_query', 400, 'invalid_request'],
    ['unavailable', 503, 'usage_unavailable'],
    ['audit_unavailable', 503, 'audit_unavailable'],
  ] as const) {
    const handler = createSsoUsageHistoryHandler({
      newRequestId: () => 'r',
      usage: { read: async () => ({ state }) },
    });
    const response = await handler(request());
    assert.equal(response.status, status);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, code);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const ready = {
    state: 'ready',
    format: 'json',
    data: [],
    hasMore: false,
    nextCursor: null,
  } as const;
  const anonymous = createSsoUsageHistoryHandler({
    newRequestId: () => 'r',
    usage: { read: async () => ready },
  });
  assert.equal((await anonymous(new Request('http://local/management/v1/usage'))).status, 503);
  const invalid = createSsoUsageHistoryHandler({
    newRequestId: () => 'r',
    usage: { read: async () => ({ ...ready, hasMore: true, nextCursor: 'invalid' }) },
  });
  assert.equal((await invalid(request())).status, 503);
  const oversized = await anonymous(
    new Request(`http://local/management/v1/usage?q=${'x'.repeat(8192)}`),
  );
  assert.equal(oversized.status, 400);
});
