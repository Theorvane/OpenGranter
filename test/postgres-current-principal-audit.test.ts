import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresRfc9068SsoCurrentPrincipalHandler as createHandler,
  type PostgresSsoCurrentPrincipalHttpPorts,
} from '../src/gateway/postgres-sso-current-principal-http.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();

async function prepare(db: PGlite) {
  for (const name of ['004_iam_snapshots.sql', '011_sso_identity_bindings.sql'])
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  await db.exec(
    await readFile(
      new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec("INSERT INTO iam_principals VALUES ('human-current','human',true)");
  await db.query(
    'INSERT INTO iam_sso_identity_bindings (issuer,subject,principal_id) VALUES ($1,$2,$3)',
    [jwt.issuer, jwt.subject, 'human-current'],
  );
}
function sql(db: PGlite) {
  return { query: (text: string, params: readonly unknown[]) => db.query(text, [...params]) };
}
function request(value = token) {
  return new Request('http://localhost/management/v1/principal', {
    headers: { authorization: `Bearer ${value}` },
  });
}
function ports(db: PGlite) {
  return {
    ...jwt.config,
    client: sql(db),
    auditClient: sql(db),
    newRequestId: () => 'principal-request',
  };
}

test('public factory persists identity-only authentication outcome before releasing principal', async () => {
  const db = new PGlite();
  try {
    await prepare(db);
    const handler = createHandler(ports(db));
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: 'human-current', kind: 'human' });
    const rows = (await db.query('SELECT * FROM sso_current_principal_audit_events')).rows;
    assert.deepEqual(rows, [
      {
        event_id: 1,
        occurred_at_ms: jwt.nowSeconds * 1000,
        request_id: 'principal-request',
        outcome: 'ready',
        principal_id: 'human-current',
      },
    ]);
  } finally {
    await db.close();
  }
});

test('fresh authentication outcomes persist anonymously on rejection and unavailable identity', async () => {
  const db = new PGlite();
  try {
    await prepare(db);
    const handler = createHandler(ports(db));
    assert.equal((await handler(request('private-invalid-token'))).status, 401);
    await db.exec('UPDATE iam_principals SET active=false');
    assert.equal((await handler(request())).status, 401);
    await db.exec('DROP TABLE iam_sso_identity_bindings');
    assert.equal((await handler(request())).status, 503);
    const rows = (
      await db.query(
        'SELECT outcome,principal_id FROM sso_current_principal_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(rows, [
      { outcome: 'unauthenticated', principal_id: null },
      { outcome: 'unauthenticated', principal_id: null },
      { outcome: 'unavailable', principal_id: null },
    ]);
    const serialized = JSON.stringify(
      (await db.query('SELECT * FROM sso_current_principal_audit_events')).rows,
    );
    for (const secret of [
      'private-invalid-token',
      token,
      jwt.subject,
      jwt.issuer,
      'credential',
      'policy',
      'prompt',
    ])
      assert.equal(serialized.includes(secret), false);
  } finally {
    await db.close();
  }
});

test('missing table and failing audit never release identity or authentication details', async () => {
  const db = new PGlite();
  try {
    await prepare(db);
    await db.exec('DROP TABLE sso_current_principal_audit_events');
    for (const value of [token, 'private-invalid-token']) {
      const response = await createHandler(ports(db))(request(value));
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.ok(body.includes('audit_unavailable'));
      for (const secret of [
        'human-current',
        token,
        'sso_current_principal_audit_events',
        'private-invalid-token',
      ])
        assert.equal(body.includes(secret), false);
    }
  } finally {
    await db.close();
  }
});

test('identity response waits for SQL acknowledgement and ignores later configuration mutation', async () => {
  const db = new PGlite();
  try {
    await prepare(db);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const config = {
      ...ports(db),
      auditClient: {
        query: async (text: string, params: readonly unknown[]) => {
          entered();
          await gate;
          return sql(db).query(text, params);
        },
      },
    };
    const handler = createHandler(config);
    config.auditClient.query = async () => {
      throw new Error('PRIVATE replacement');
    };
    config.now = () => -1;
    let settled = false;
    const pending = handler(request()).then((response) => {
      settled = true;
      return response;
    });
    await started;
    assert.equal(settled, false);
    assert.equal(
      (await db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      0,
    );
    release();
    assert.equal((await pending).status, 200);
    assert.equal(
      (await db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});

test('file-backed local SQL records survive close/reopen independently of callback memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-principal-audit-'));
  let db = new PGlite(dir);
  try {
    await prepare(db);
    assert.equal((await createHandler(ports(db))(request())).status, 200);
    await db.close();
    db = new PGlite(dir);
    assert.deepEqual(
      (await db.query('SELECT outcome,principal_id FROM sso_current_principal_audit_events')).rows,
      [{ outcome: 'ready', principal_id: 'human-current' }],
    );
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('factory requires exactly one valid own audit configuration and cannot silently downgrade', () => {
  const client = { query: async () => ({ rows: [] }) };
  const base = { ...jwt.config, client, newRequestId: () => 'r' };
  for (const extras of [
    {},
    { auditClient: undefined },
    { auditClient: null },
    { auditClient: {} },
    { writeAudit: undefined },
    { writeAudit: async () => {}, auditClient: client },
    { writeAudit: async () => {}, auditClient: undefined },
  ])
    assert.throws(
      () =>
        createHandler({ ...base, ...extras } as unknown as PostgresSsoCurrentPrincipalHttpPorts),
      { name: 'InvalidSsoAccessTokenConfiguration' },
    );
  assert.throws(() => createHandler(Object.assign(Object.create({ auditClient: client }), base)), {
    name: 'InvalidSsoAccessTokenConfiguration',
  });
  assert.doesNotThrow(() => createHandler({ ...base, writeAudit: async () => {} }));
});

test('public Node socket uses the concrete persisted audit mode without a session grant', async () => {
  const db = new PGlite();
  const { createPostgresRfc9068SsoCurrentPrincipalServer } = await import(
    '../src/gateway/postgres-sso-current-principal-http.ts'
  );
  let server: ReturnType<typeof createPostgresRfc9068SsoCurrentPrincipalServer> | undefined;
  try {
    await prepare(db);
    server = createPostgresRfc9068SsoCurrentPrincipalServer(ports(db));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/management/v1/principal`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: 'human-current', kind: 'human' });
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(
      (await db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      1,
    );
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    await db.close();
  }
});

test('optional DDL is excluded from default migration loading and enforces identity attribution', async () => {
  const { loadPostgresMigrationSources } = await import(
    '../src/storage/postgres-migration-sources.ts'
  );
  const sources = await loadPostgresMigrationSources();
  assert.equal(sources.length, 12);
  assert.equal(
    sources.some((source) => source.sql.includes('sso_current_principal_audit_events')),
    false,
  );
  const db = new PGlite();
  try {
    await prepare(db);
    for (const [outcome, principal] of [
      ['ready', null],
      ['unavailable', 'human-current'],
      ['unauthenticated', 'human-current'],
      ['private', null],
    ]) {
      await assert.rejects(
        db.query(
          'INSERT INTO sso_current_principal_audit_events (occurred_at_ms,request_id,outcome,principal_id) VALUES (0,$1,$2,$3)',
          ['r', outcome, principal],
        ),
      );
    }
    assert.equal(
      (await db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test('invalid SQL acknowledgement and rejection suppress successful authenticated identity at HTTP boundary', async () => {
  const db = new PGlite();
  try {
    await prepare(db);
    for (const query of [
      async () => ({ rows: [] }),
      async () => ({ rows: [{ event_id: '0' }] }),
      async () => {
        throw new Error('PRIVATE database');
      },
    ]) {
      const handler = createHandler({ ...ports(db), auditClient: { query } });
      const response = await handler(request());
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.ok(text.includes('audit_unavailable'));
      assert.equal(text.includes('PRIVATE'), false);
      assert.equal(text.includes('human-current'), false);
    }
  } finally {
    await db.close();
  }
});
