import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoUsageHistoryServer } from '../src/gateway/postgres-sso-usage-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('signed direct usage HTTP rejects C1 filters before storage with durable invalid-query audit', async () => {
  const db = new PGlite();
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  let usageReads = 0;
  let id = 0;
  const server = createPostgresSsoUsageHistoryServer({
    ...jwt.config,
    client: {
      query: (text, values) => {
        if (text.includes('FROM usage_records')) usageReads++;
        return db.query(text, [...values]);
      },
    },
    newRequestId: () => `invalid-${++id}`,
  });
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    // Ephemeral candidate schema only; no deployment DDL or listener activation.
    await db.exec(
      await readFile(new URL('../contracts/sso-usage-audit-schema.sql', import.meta.url), 'utf8'),
    );
    await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true);
      INSERT INTO iam_policies VALUES ('p','v1','[{"effect":"Allow","actions":["usage:ReadAll"],"resources":["principal:*"]}]');
      INSERT INTO iam_roles VALUES ('reader'); INSERT INTO iam_principal_roles VALUES ('human','reader');
      INSERT INTO iam_role_policies VALUES ('reader','p');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('no address');
    for (const format of ['json', 'csv']) {
      for (const code of [0x80, 0x85, 0x9f]) {
        const query = new URLSearchParams({
          principal_id: `human${String.fromCharCode(code)}other`,
          format,
        });
        const response = await fetch(
          `http://127.0.0.1:${address.port}/management/v1/usage?${query}`,
          {
            headers: { authorization: `Bearer ${token}` },
          },
        );
        assert.equal(response.status, 400);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.text();
        assert.equal(JSON.parse(body).error.code, 'invalid_request');
        assert.ok(!body.includes(token));
        assert.ok(!body.includes('other'));
      }
    }
    assert.equal(usageReads, 0);
    const audit = await db.query(
      'SELECT outcome, principal_id, target_principal_id, mode, record_count FROM sso_usage_audit_events ORDER BY event_id',
    );
    assert.equal(audit.rows.length, 6);
    for (const row of audit.rows)
      assert.deepEqual(row, {
        outcome: 'invalid_query',
        principal_id: 'human',
        target_principal_id: null,
        mode: null,
        record_count: 0,
      });
    await db.exec('DROP TABLE sso_usage_audit_events');
    const failedAudit = await fetch(
      `http://127.0.0.1:${address.port}/management/v1/usage?principal_id=human%C2%80other`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    assert.equal(failedAudit.status, 503);
    assert.equal(
      ((await failedAudit.json()) as { error: { code: string } }).error.code,
      'audit_unavailable',
    );
    assert.equal(usageReads, 0);
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await db.close();
  }
});
