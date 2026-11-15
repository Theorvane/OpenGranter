import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runCanonicalReviewService } from '../src/gateway/canonical-review-service.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('explicit canonical review process starts migrated HTTP, enforces signed bearer and fresh revocation, then closes', {
  timeout: 30000,
}, async () => {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const directory = await mkdtemp(join(tmpdir(), 'og-sso-service-'));
  const artifact = join(directory, 'app.js');
  await writeFile(artifact, 'export {};');
  const jwt = await createSsoAccessTokenFixture();
  const db = new PGlite();
  let closed = false;
  let closes = 0;
  const connection: PostgresConnection = {
    query: (sql, params) => db.query(sql, [...params]),
    transaction: (callback) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
    close: async () => {
      closes++;
      closed = true;
      await db.close();
    },
  };
  const signals = new EventEmitter();
  const messages: string[] = [];
  const exits: number[] = [];
  let announce: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const done = runCanonicalReviewService({
    env: {
      OPENGRANTER_BOOTSTRAP_MODULE: '/trusted/sso-service.ts',
      OPENGRANTER_PORT: String(port),
    },
    signals,
    report: (message) => {
      messages.push(message);
      announce();
    },
    exit: (code) => {
      exits.push(code);
      announce();
    },
    loadModule: async () => ({
      createCanonicalReviewPorts: () => ({
        ...jwt.config,
        browserArtifactPath: artifact,
        browserArtifactSha256: createHash('sha256').update('export {};').digest('hex'),
        openConnection: () => connection,
      }),
    }),
  });
  try {
    await ready;
    assert.deepEqual(messages, ['Gateway listening']);
    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(`${base}/management`);
    assert.equal(page.status, 200);
    await page.text();
    const script = await fetch(`${base}/management/app.js`);
    assert.equal(await script.text(), 'export {};');
    assert.equal(script.headers.get('cache-control'), 'no-store');
    const anonymous = await fetch(`${base}/management/v1/models`);
    assert.equal(anonymous.status, 401);
    await anonymous.text();
    await db.exec("INSERT INTO iam_principals VALUES ('human','human',true)");
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    // The executable owns the real clock; a deployment module cannot substitute fixture time.
    const seconds = Math.floor(Date.now() / 1000);
    const bearer = await jwt.token({
      iat: seconds - 10,
      exp: seconds + 600,
      auth_time: seconds - 100,
    });
    const headers = { authorization: `Bearer ${bearer}` };
    const allowed = await fetch(`${base}/management/v1/models`, { headers });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { object: 'list', data: [] });
    await db.exec(`
      INSERT INTO iam_policies VALUES ('allow', 'v1',
        '[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider"],"resources":["model:*","provider:openai"]}]');
      INSERT INTO iam_principal_policies VALUES ('human', 'allow');
      INSERT INTO catalog_models (alias, created_at_seconds, enabled) VALUES ('team/chat', 42, true);
      INSERT INTO catalog_routes (route_id, alias, kind, version, credential_ref, candidates) VALUES
        ('direct', 'team/chat', 'managed', 'v1', NULL,
         '[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-upstream"}]');
      UPDATE catalog_models SET active_route_id = 'direct' WHERE alias = 'team/chat';
    `);
    const listed = await fetch(`${base}/management/v1/models`, { headers });
    assert.equal(listed.status, 200);
    const publication = { id: 'team/chat', object: 'model', created: 42, owned_by: 'opengranter' };
    assert.deepEqual(await listed.json(), { object: 'list', data: [publication] });
    const detail = await fetch(`${base}/management/v1/models/team%2Fchat`, { headers });
    assert.equal(detail.status, 200);
    assert.deepEqual(await detail.json(), publication);
    await db.exec(`
      UPDATE iam_policies SET statements = '[{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]';
    `);
    for (const resource of ['usage', 'audit']) {
      const json = await fetch(`${base}/management/v1/${resource}`, { headers });
      assert.equal(json.status, 200);
      assert.deepEqual(((await json.json()) as { data: unknown[] }).data, []);
      const csv = await fetch(`${base}/management/v1/${resource}?format=csv`, { headers });
      assert.equal(csv.status, 200);
      assert.match(csv.headers.get('content-type') ?? '', /^text\/csv/u);
      assert.doesNotMatch(await csv.text(), /private-upstream|Bearer/u);
    }
    for (const path of ['/management/v1/proxy-tokens', '/v1/models']) {
      const missing = await fetch(base + path, { headers });
      assert.equal(missing.status, 404);
      await missing.text();
    }
    const cookie = await fetch(`${base}/management/v1/usage`, {
      headers: { cookie: 'session=not-authority' },
    });
    assert.equal(cookie.status, 401);
    await cookie.text();
    await db.exec('DROP TABLE sso_usage_audit_events');
    const failedAudit = await fetch(`${base}/management/v1/usage`, { headers });
    assert.equal(failedAudit.status, 503);
    assert.doesNotMatch(await failedAudit.text(), /SELECT|INSERT|private-upstream/u);
    await db.exec(
      `UPDATE iam_policies SET version='v2', statements='[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:*"]}]'`,
    );
    const denied = await fetch(`${base}/management/v1/models/team%2Fchat`, { headers });
    assert.equal(denied.status, 404);
    await denied.text();
    await db.exec('DELETE FROM iam_sso_identity_bindings');
    const revoked = await fetch(`${base}/management/v1/models`, { headers });
    assert.equal(revoked.status, 401);
    await revoked.text();
    const audit = JSON.stringify((await db.query('SELECT * FROM sso_catalog_audit_events')).rows);
    assert.equal(audit.includes(bearer), false);
    assert.equal(audit.includes(jwt.subject), false);
  } finally {
    signals.emit('SIGTERM');
    await done;
    if (!closed) await db.close();
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(closed, true);
  assert.equal(closes, 1);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/management`));
  assert.deepEqual(exits, [0]);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});
