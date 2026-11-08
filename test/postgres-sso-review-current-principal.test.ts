import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoReviewBrowserServer } from '../src/gateway/postgres-sso-review-browser-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('same-origin review exposes fresh identity without exposing token mutations', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec("INSERT INTO iam_principals VALUES ('human-admin','human',true)");
  await db.query(
    'INSERT INTO iam_sso_identity_bindings (issuer, subject, principal_id) VALUES ($1,$2,$3)',
    [jwt.issuer, jwt.subject, 'human-admin'],
  );
  let queries = 0;
  let ids = 0;
  const server = createPostgresSsoReviewBrowserServer({
    ...jwt.config,
    client: {
      query: (text, values) => {
        queries++;
        return db.query(text, [...values]);
      },
    },
    newRequestId: () => `principal-review-${++ids}`,
    javascript: 'export const publicReview = true;',
  });
  assert.equal(server.listening, false);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    const me = (suffix = '', headers: Record<string, string> = {}) =>
      fetch(`${origin}/management/v1/me${suffix}`, {
        headers: { authorization: `Bearer ${token}`, ...headers },
      });
    const response = await me();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-request-id'), 'principal-review-1');
    assert.deepEqual(await response.json(), { principalId: 'human-admin' });
    // Identity must not turn into catalog permission: no IAM Allow exists.
    const catalog = await fetch(`${origin}/management/v1/models`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(catalog.status, 200);
    assert.deepEqual(await catalog.json(), { object: 'list', data: [] });
    const invalid = await me('?token=private-query');
    assert.equal(invalid.status, 400);
    assert.doesNotMatch(await invalid.text(), /private-query|human-admin/);
    const cookie = await me('', { authorization: '', cookie: 'session=not-authority' });
    assert.equal(cookie.status, 401);
    await cookie.text();
    for (const [method, path] of [
      ['POST', '/management/v1/me'],
      ['GET', '/management/v1/me/'],
      ['POST', '/management/v1/proxy-tokens'],
      ['POST', '/management/v1/proxy-tokens/revoke'],
    ] as const) {
      const before = queries;
      const blocked = await fetch(origin + path, {
        method,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(blocked.status, 404);
      await blocked.text();
      assert.equal(queries, before);
    }
    const beforePublic = queries;
    const asset = await fetch(`${origin}/management/app.js`);
    assert.equal(asset.status, 200);
    await asset.text();
    assert.equal(queries, beforePublic);
    await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human-admin'");
    const inactive = await me();
    assert.equal(inactive.status, 401);
    await inactive.text();
    await db.exec(
      "UPDATE iam_principals SET active=true WHERE principal_id='human-admin'; DELETE FROM iam_sso_identity_bindings",
    );
    const revoked = await me();
    assert.equal(revoked.status, 401);
    await revoked.text();
    const audit = await db.query(
      'SELECT kind, principal_id, credential_id, details FROM gateway_audit_events',
    );
    assert.equal(audit.rows.length, 3);
    const serialized = JSON.stringify(audit.rows);
    assert.match(serialized, /current-principal/);
    assert.doesNotMatch(serialized, /not-authority|Bearer|private-query/);
    assert.equal(serialized.includes(token), false);
    await db.exec('DROP TABLE gateway_audit_events');
    const failed = await me();
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get('cache-control'), 'no-store');
    assert.match(await failed.text(), /audit_unavailable/);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
