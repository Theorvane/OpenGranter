import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresSsoUsageHistory,
  type SsoUsageAuditEvent,
} from '../src/gateway/postgres-sso-usage-history.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture(hook?: (event: SsoUsageAuditEvent) => Promise<void>) {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`
    INSERT INTO iam_principals VALUES ('human', 'human', true), ('other', 'human', true);
    INSERT INTO iam_policies VALUES ('allow', 'v1',
      '[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
    INSERT INTO iam_roles VALUES ('reader');
    INSERT INTO iam_principal_roles VALUES ('human', 'reader');
    INSERT INTO iam_role_policies VALUES ('reader', 'allow');
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  const sql: string[] = [];
  let sqlFailure = false;
  let auditFailure = false;
  const events: SsoUsageAuditEvent[] = [];
  const client = {
    query: (query: string, params: readonly unknown[]) => {
      sql.push(query);
      if (sqlFailure && query.includes('FROM usage_records')) throw Error('private database fault');
      return db.query(query, [...params]);
    },
  };
  const ledger = createPostgresUsageLedger(client);
  for (const [principalId, attemptId, occurredAt, modelAlias] of [
    ['human', 'attempt-a', 100, 'chat'],
    ['human', 'attempt-b', 100, 'chat'],
    ['human', 'attempt-c', 200, 'other-model'],
    ['other', 'foreign', 300, 'chat'],
  ] as const) {
    await ledger(
      buildUsageRecord({
        principalId,
        attemptId,
        occurredAt,
        modelAlias,
        credentialId: 'existing-proxy-credential',
        policyVersions: [{ id: 'original', version: 'v1' }],
        requestId: 'chat-request',
        routeKind: 'managed',
        upstreamModelId: 'gpt',
        selectedCandidateId: 'candidate',
        actualInferenceProviderId: 'openai',
        latencyMs: 5,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: true,
      }),
    );
  }
  sql.length = 0;
  const service = createPostgresSsoUsageHistory({
    ...jwt.config,
    client,
    writeAudit: async (event) => {
      if (auditFailure) throw Error('private audit fault');
      await hook?.(event);
      events.push(event);
    },
  });
  return {
    db,
    service,
    sql,
    events,
    failSql: () => {
      sqlFailure = true;
    },
    failAudit: () => {
      auditFailure = true;
    },
  };
}

test('SSO usage reads real scoped SQL, filters and stable cursor without fabricating usage', async () => {
  const f = await fixture();
  try {
    const first = await f.service.read(
      token,
      'request-1',
      '?limit=1&model=chat&from_ms=100&to_ms=200',
    );
    assert.equal(first.state, 'ready');
    if (first.state !== 'ready' || first.format !== 'json') throw Error('expected JSON');
    assert.deepEqual(
      first.data.map((row) => row.attemptId),
      ['attempt-b'],
    );
    assert.equal(first.data[0]?.usage.status, 'missing');
    assert.equal(first.data[0]?.upstreamBilledCost, null);
    assert.equal(first.data[0]?.possibleDuplicate, true);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);
    const second = await f.service.read(
      token,
      'request-2',
      `?limit=1&model=chat&from_ms=100&to_ms=200&cursor=${first.nextCursor}`,
    );
    assert.equal(second.state, 'ready');
    if (second.state !== 'ready' || second.format !== 'json') throw Error('expected JSON');
    assert.deepEqual(
      second.data.map((row) => row.attemptId),
      ['attempt-a'],
    );
    assert.equal(second.nextCursor, null);
    assert.equal(second.hasMore, false);
    assert.ok(f.sql.some((sql) => sql.includes('FROM usage_records')));
    assert.equal(f.events.length, 2);
    assert.equal(f.events[0]?.principalId, 'human');
    assert.equal(f.events[0]?.count, 1);
    assert.equal(JSON.stringify(f.events).includes('credential'), false);
    assert.equal(JSON.stringify(f.events).includes(token), false);
  } finally {
    await f.db.close();
  }
});

test('explicit self and foreign target require ReadAll; fresh role change allows selected target only', async () => {
  const f = await fixture();
  try {
    for (const target of ['human', 'other']) {
      assert.deepEqual(await f.service.read(token, 'denied', `?principal_id=${target}`), {
        state: 'forbidden',
      });
    }
    assert.equal(
      f.sql.some((sql) => sql.includes('FROM usage_records')),
      false,
    );
    await f.db.query('UPDATE iam_policies SET version=$1, statements=$2 WHERE policy_id=$3', [
      'v2',
      [{ effect: 'Allow', actions: ['usage:ReadAll'], resources: ['principal:other'] }],
      'allow',
    ]);
    const result = await f.service.read(token, 'allowed', '?principal_id=other');
    assert.equal(result.state, 'ready');
    if (result.state !== 'ready' || result.format !== 'json') throw Error('expected JSON');
    assert.deepEqual(
      result.data.map((row) => row.attemptId),
      ['foreign'],
    );
    assert.deepEqual(f.events.at(-1)?.policyVersions, [{ id: 'allow', version: 'v2' }]);
    await f.db.query('UPDATE iam_policies SET statements=$1 WHERE policy_id=$2', [
      [
        { effect: 'Allow', actions: ['usage:*'], resources: ['principal:*'] },
        { effect: 'Deny', actions: ['usage:ReadAll'], resources: ['principal:other'] },
      ],
      'allow',
    ]);
    assert.deepEqual(await f.service.read(token, 'explicit-deny', '?principal_id=other'), {
      state: 'forbidden',
    });
  } finally {
    await f.db.close();
  }
});

test('CSV preserves unknown values; empty query result is successful', async () => {
  const f = await fixture();
  try {
    const result = await f.service.read(token, 'csv', '?format=csv&model=chat');
    assert.equal(result.state, 'ready');
    if (result.state !== 'ready' || result.format !== 'csv') throw Error('expected CSV');
    assert.match(result.csv, /usage_status/);
    assert.match(result.csv, /missing/);
    assert.equal(result.csv.includes('foreign'), false);
    const empty = await f.service.read(token, 'empty', '?model=missing');
    assert.deepEqual(empty, {
      state: 'ready',
      format: 'json',
      data: [],
      hasMore: false,
      nextCursor: null,
    });
  } finally {
    await f.db.close();
  }
});

test('malformed/expired JWT, disabled principal and removed binding never read usage', async () => {
  const f = await fixture();
  try {
    for (const value of [
      '',
      'not-a-jwt',
      await jwt.token({ exp: jwt.nowSeconds - 120, iat: jwt.nowSeconds - 300 }),
    ]) {
      assert.deepEqual(await f.service.read(value, 'unauthenticated', ''), {
        state: 'unauthenticated',
      });
    }
    await f.db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human'");
    assert.deepEqual(await f.service.read(token, 'disabled', ''), { state: 'unauthenticated' });
    await f.db.exec(
      "UPDATE iam_principals SET active=true WHERE principal_id='human'; DELETE FROM iam_sso_identity_bindings",
    );
    assert.deepEqual(await f.service.read(token, 'unbound', ''), { state: 'unauthenticated' });
    assert.equal(
      f.sql.some((sql) => sql.includes('FROM usage_records')),
      false,
    );
    assert.ok(f.events.every((event) => event.principalId === null));
  } finally {
    await f.db.close();
  }
});

test('invalid query never reads usage SQL; failures are fixed and mandatory-audited', async () => {
  const f = await fixture();
  try {
    for (const query of [
      '?limit=0',
      '?limit=1&limit=2',
      '?unknown=private',
      '?cursor=broken',
      '?from_ms=2&to_ms=1',
      '?format=xml',
    ]) {
      assert.deepEqual(await f.service.read(token, 'invalid', query), { state: 'invalid_query' });
    }
    assert.equal(
      f.sql.some((sql) => sql.includes('FROM usage_records')),
      false,
    );
    f.failSql();
    assert.deepEqual(await f.service.read(token, 'unavailable', ''), { state: 'unavailable' });
    assert.equal(f.events.at(-1)?.outcome, 'unavailable');
    f.failAudit();
    assert.deepEqual(await f.service.read(token, 'audit-unavailable', ''), {
      state: 'audit_unavailable',
    });
  } finally {
    await f.db.close();
  }
});

test('success cannot escape before audit commits; failed audit suppresses ready records', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = await fixture(async () => {
    entered();
    await gate;
  });
  try {
    let settled = false;
    const pending = f.service.read(token, 'awaited', '').then((value) => {
      settled = true;
      return value;
    });
    await waiting;
    assert.equal(settled, false);
    release();
    assert.equal((await pending).state, 'ready');
    f.failAudit();
    assert.deepEqual(await f.service.read(token, 'failed', ''), { state: 'audit_unavailable' });
  } finally {
    release();
    await f.db.close();
  }
});

test('estimated and upstream-reported prices remain separate exact values in JSON and CSV', async () => {
  const f = await fixture();
  try {
    await f.db.query(`UPDATE usage_records SET record = record || $1::jsonb WHERE attempt_id=$2`, [
      {
        estimatedCost: {
          amountDecimal: '0.001234567890',
          currency: 'USD',
          priceVersion: 'reviewed-v3',
        },
        upstreamBilledCost: {
          amountDecimal: '0.009870000',
          currency: 'USD',
          source: 'direct-provider',
        },
        privatePrompt: 'never-display-this-content',
      },
      'attempt-b',
    ]);
    const result = await f.service.read(token, 'exact-money', '?model=chat&limit=1');
    if (result.state !== 'ready' || result.format !== 'json') throw Error('expected JSON');
    assert.deepEqual(result.data[0]?.estimatedCost, {
      amountDecimal: '0.001234567890',
      currency: 'USD',
      priceVersion: 'reviewed-v3',
    });
    assert.deepEqual(result.data[0]?.upstreamBilledCost, {
      amountDecimal: '0.009870000',
      currency: 'USD',
      source: 'direct-provider',
    });
    assert.equal(JSON.stringify(result).includes('never-display'), false);
    const csv = await f.service.read(token, 'csv-exact-money', '?model=chat&limit=1&format=csv');
    if (csv.state !== 'ready' || csv.format !== 'csv') throw Error('expected CSV');
    assert.match(csv.csv, /0\.001234567890/);
    assert.match(csv.csv, /0\.009870000/);
    assert.equal(csv.csv.includes('never-display'), false);
  } finally {
    await f.db.close();
  }
});

test('audit failure suppresses denial, invalid-query and unauthenticated outcomes too', async () => {
  const f = await fixture();
  try {
    f.failAudit();
    for (const [value, query] of [
      [token, '?principal_id=other'],
      [token, '?limit=0'],
      ['', '?private=not-audit-content'],
    ]) {
      assert.deepEqual(await f.service.read(value ?? '', 'fail-closed', query ?? ''), {
        state: 'audit_unavailable',
      });
    }
    assert.equal(
      f.sql.some((sql) => sql.includes('FROM usage_records')),
      false,
    );
  } finally {
    await f.db.close();
  }
});

test('corrupted cross-principal ledger content fails closed and does not reach CSV', async () => {
  const f = await fixture();
  try {
    await f.db.query(
      `UPDATE usage_records SET record = jsonb_set(record, '{principalId}', '"other"') WHERE attempt_id=$1`,
      ['attempt-b'],
    );
    assert.deepEqual(await f.service.read(token, 'corrupt', '?format=csv&model=chat'), {
      state: 'unavailable',
    });
    assert.equal(f.events.at(-1)?.count, 0);
  } finally {
    await f.db.close();
  }
});

test('missing audit dependency is rejected and trusted ports are captured at construction', async () => {
  const f = await fixture();
  try {
    const ports = {
      ...jwt.config,
      client: { query: (sql: string, params: readonly unknown[]) => f.db.query(sql, [...params]) },
      writeAudit: async (_event: SsoUsageAuditEvent) => {},
    };
    assert.throws(
      () => createPostgresSsoUsageHistory({ ...ports, writeAudit: undefined as never }),
      { name: 'InvalidSsoAccessTokenConfiguration' },
    );
    const service = createPostgresSsoUsageHistory(ports);
    ports.writeAudit = async () => {
      throw Error('replaced writer');
    };
    assert.equal((await service.read(token, 'captured', '')).state, 'ready');
  } finally {
    await f.db.close();
  }
});

test('oversized stored attempt ID cannot create an unusable next-page cursor', async () => {
  const f = await fixture();
  try {
    const oversized = 'z'.repeat(513);
    await f.db.query(
      `UPDATE usage_records SET attempt_id=$1, record=jsonb_set(record, '{attemptId}', to_jsonb($1::text)) WHERE attempt_id=$2`,
      [oversized, 'attempt-c'],
    );
    assert.deepEqual(await f.service.read(token, 'cursor-bounds', '?limit=1'), {
      state: 'unavailable',
    });
    assert.equal(f.events.at(-1)?.count, 0);
  } finally {
    await f.db.close();
  }
});

for (const format of ['json', 'csv']) {
  test(`multibyte continuation exceeding encoded bounds fails closed for ${format}`, async () => {
    const f = await fixture();
    try {
      await f.db.query(
        `UPDATE usage_records SET attempt_id=$1, record=jsonb_set(record, '{attemptId}', to_jsonb($1::text)) WHERE attempt_id=$2`,
        ['界'.repeat(512), 'attempt-c'],
      );
      assert.deepEqual(
        await f.service.read(token, 'multibyte-cursor', `?limit=1&format=${format}`),
        {
          state: 'unavailable',
        },
      );
      assert.equal(f.events.at(-1)?.outcome, 'unavailable');
      assert.equal(f.events.at(-1)?.count, 0);
      f.failAudit();
      assert.deepEqual(await f.service.read(token, 'failed-audit', `?limit=1&format=${format}`), {
        state: 'audit_unavailable',
      });
    } finally {
      await f.db.close();
    }
  });
}

for (const attemptId of ['z'.repeat(512), '界'.repeat(500), '😀'.repeat(256)]) {
  test(`accepted cursor round-trips for ${attemptId.slice(0, 2)}`, async () => {
    const f = await fixture();
    try {
      await f.db.query(
        `UPDATE usage_records SET attempt_id=$1, record=jsonb_set(record, '{attemptId}', to_jsonb($1::text)) WHERE attempt_id=$2`,
        [attemptId, 'attempt-c'],
      );
      const first = await f.service.read(token, 'first-page', '?limit=1');
      if (first.state !== 'ready' || first.format !== 'json') throw Error('expected JSON');
      assert.equal(first.hasMore, true);
      assert.equal(first.data[0]?.attemptId, attemptId);
      assert.ok(first.nextCursor);
      const second = await f.service.read(
        token,
        'second-page',
        `?limit=1&cursor=${first.nextCursor}`,
      );
      if (second.state !== 'ready' || second.format !== 'json') throw Error('expected next page');
      assert.equal(second.data[0]?.attemptId, 'attempt-b');
    } finally {
      await f.db.close();
    }
  });
}

test('final multibyte record needs no continuation cursor', async () => {
  const f = await fixture();
  try {
    await f.db.query(
      `UPDATE usage_records SET attempt_id=$1, record=jsonb_set(record, '{attemptId}', to_jsonb($1::text)) WHERE attempt_id=$2`,
      ['界'.repeat(512), 'attempt-c'],
    );
    const result = await f.service.read(token, 'final-page', '?from_ms=200');
    if (result.state !== 'ready' || result.format !== 'json') throw Error('expected JSON');
    assert.equal(result.data.length, 1);
    assert.equal(result.hasMore, false);
    assert.equal(result.nextCursor, null);
  } finally {
    await f.db.close();
  }
});
