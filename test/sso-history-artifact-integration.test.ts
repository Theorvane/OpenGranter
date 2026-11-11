import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoBrowserGateway } from '../src/gateway/postgres-sso-browser-bootstrap.ts';
import { loadSsoBrowserBootstrap } from '../src/gateway/sso-operator-bootstrap.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const javascript = 'export const label = "사용량";';
const pin = createHash('sha256').update(javascript).digest('hex');

async function configuration(directory: string) {
  const jwt = await createSsoAccessTokenFixture();
  const jwksPath = join(directory, 'jwks.json');
  const artifactPath = join(directory, 'app.js');
  await writeFile(jwksPath, JSON.stringify(jwt.config.jwks));
  await writeFile(artifactPath, javascript);
  return {
    jwt,
    artifactPath,
    env: {
      OPENGRANTER_SSO_ISSUER: jwt.issuer,
      OPENGRANTER_SSO_AUDIENCE: jwt.audience,
      OPENGRANTER_SSO_JWKS_PATH: jwksPath,
      OPENGRANTER_BROWSER_ARTIFACT_PATH: artifactPath,
      OPENGRANTER_BROWSER_ARTIFACT_SHA256: pin,
    },
  };
}

for (const enabled of [undefined, 'false', 'true']) {
  test(`operator composes artifact integrity with history switch: ${enabled}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'og-history-artifact-'));
    const db = new PGlite();
    let opens = 0;
    let closes = 0;
    let sequence = 0;
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
        await db.close();
      },
    };
    try {
      const { env, jwt, artifactPath } = await configuration(directory);
      const ports = await loadSsoBrowserBootstrap(
        { ...env, ...(enabled === undefined ? {} : { OPENGRANTER_SSO_HISTORY_READS: enabled }) },
        () => {
          opens++;
          return connection;
        },
      );
      assert.equal((ports as unknown as Record<string, unknown>).browserArtifactSha256, pin);
      assert.equal(
        ports.enableHistoryReads,
        enabled === undefined ? undefined : enabled === 'true',
      );
      assert.equal(opens, 0);
      const runtime = await startPostgresSsoBrowserGateway({
        ...ports,
        now: jwt.config.now,
        host: '127.0.0.1',
        port: 0,
        newRequestId: () => `composed-${++sequence}`,
      });
      try {
        const origin = `http://127.0.0.1:${runtime.address.port}`;
        await writeFile(artifactPath, 'export const replaced = true;');
        assert.equal(await (await fetch(`${origin}/management/app.js`)).text(), javascript);
        await db.exec(`
          INSERT INTO iam_principals VALUES ('human', 'human', true);
          INSERT INTO iam_policies VALUES ('allow', 'v1',
            '[{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]');
          INSERT INTO iam_principal_policies VALUES ('human', 'allow');
        `);
        await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
          jwt.issuer,
          jwt.subject,
          'human',
        ]);
        const token = await jwt.token();
        for (const kind of ['usage', 'audit']) {
          const response = await fetch(`${origin}/management/v1/${kind}`, {
            headers: { authorization: `Bearer ${token}` },
          });
          assert.equal(response.status, enabled === 'true' ? 200 : 404);
          assert.equal(response.headers.get('cache-control'), 'no-store');
          const body = await response.json();
          if (enabled === 'true')
            assert.deepEqual(body, {
              object: 'list',
              data: [],
              has_more: false,
              next_cursor: null,
            });
        }
        if (enabled === 'true') {
          for (const table of ['sso_usage_audit_events', 'sso_audit_history_access_events']) {
            const events = await db.query(`SELECT outcome, principal_id FROM ${table}`);
            assert.deepEqual(events.rows, [{ outcome: 'ready', principal_id: 'human' }]);
          }
          await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human'");
          assert.equal(
            (
              await fetch(`${origin}/management/v1/usage`, {
                headers: { authorization: `Bearer ${token}` },
              })
            ).status,
            401,
          );
        }
      } finally {
        await runtime.close();
      }
      assert.equal(opens, 1);
      assert.equal(closes, 1);
    } finally {
      if (!closes) await db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('composed operator rejects either malformed option before database ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-history-pin-invalid-'));
  let opens = 0;
  const openConnection = (): PostgresConnection => {
    opens++;
    throw new Error('must not open');
  };
  try {
    const { env } = await configuration(directory);
    for (const options of [
      { OPENGRANTER_BROWSER_ARTIFACT_SHA256: 'bad', OPENGRANTER_SSO_HISTORY_READS: 'true' },
      { OPENGRANTER_BROWSER_ARTIFACT_SHA256: pin, OPENGRANTER_SSO_HISTORY_READS: 'TRUE' },
    ])
      await assert.rejects(loadSsoBrowserBootstrap({ ...env, ...options }, openConnection), {
        name: 'SsoOperatorBootstrapUnavailable',
      });
    const ports = await loadSsoBrowserBootstrap(
      {
        ...env,
        OPENGRANTER_BROWSER_ARTIFACT_SHA256: '0'.repeat(64),
        OPENGRANTER_SSO_HISTORY_READS: 'true',
      },
      openConnection,
    );
    await assert.rejects(
      startPostgresSsoBrowserGateway({
        ...ports,
        host: '127.0.0.1',
        port: 0,
        now: Date.now,
        newRequestId: () => 'bad-pin',
      }),
      { name: 'ManagementBrowserArtifactUnavailable' },
    );
    assert.equal(opens, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
