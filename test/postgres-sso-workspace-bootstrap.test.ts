import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import type { SsoAuditHistoryAccessEvent } from '../src/gateway/postgres-sso-audit-history.ts';
import { startPostgresSsoWorkspaceBrowserGateway } from '../src/gateway/postgres-sso-browser-bootstrap.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const sso = await createSsoAccessTokenFixture();

test('workspace artifact connects scoped audit JSON/CSV and existing routes without schema installation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-workspace-artifact-'));
  const path = join(directory, 'app.js');
  const published = join(directory, 'published.js');
  const build = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/build-management-workspace.ts', '--output', published],
    { encoding: 'utf8' },
  );
  assert.equal(build.status, 0, build.stderr);
  const receipt = JSON.parse(build.stdout);
  assert.equal(receipt.profile, 'sso-workspace-v1');
  const javascript = await readFile(published, 'utf8');
  await symlink(published, path);
  const db = new PGlite();
  let opens = 0;
  let closes = 0;
  let failAudit = false;
  const accessEvents: SsoAuditHistoryAccessEvent[] = [];
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
    const runtime = await startPostgresSsoWorkspaceBrowserGateway({
      ...sso.config,
      host: '127.0.0.1',
      port: 0,
      newRequestId: () => 'artifact-bootstrap',
      browserArtifactPath: path,
      browserArtifactSha256: receipt.sha256,
      writeAuditHistoryAccess: async (event) => {
        if (failAudit) throw new Error('private writer failure');
        accessEvents.push(event);
      },
      openConnection: () => {
        opens++;
        return connection;
      },
    });
    try {
      const origin = `http://127.0.0.1:${runtime.address.port}`;
      const page = await fetch(`${origin}/management`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /src="\/management\/app.js"/);
      const script = await fetch(`${origin}/management/app.js`);
      assert.equal(script.status, 200);
      assert.equal(await script.text(), javascript);
      assert.equal(script.headers.get('cache-control'), 'no-store');
      const me = await fetch(`${origin}/management/v1/me`);
      assert.equal(me.status, 503);
      assert.equal(
        ((await me.json()) as { error: { code: string } }).error.code,
        'audit_unavailable',
      );
      await db.exec(
        await readFile(
          new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
          'utf8',
        ),
      );
      await db.exec("INSERT INTO iam_principals VALUES ('workspace-human','human',true)");
      await db.query(
        'INSERT INTO iam_sso_identity_bindings (issuer,subject,principal_id) VALUES ($1,$2,$3)',
        [sso.issuer, sso.subject, 'workspace-human'],
      );
      const token = await sso.token();
      const account = await fetch(`${origin}/management/v1/me`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(account.status, 200);
      assert.deepEqual(await account.json(), { principalId: 'workspace-human' });
      await db.exec(`
        INSERT INTO iam_policies VALUES ('artifact-audit','v1','[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:workspace-human"]}]');
        INSERT INTO iam_principal_policies VALUES ('workspace-human','artifact-audit');
      `);
      const store = createPostgresGatewayAuditStore(connection, () => 100);
      await store.append({
        kind: 'request-denied',
        reason: 'invalid-request',
        requestId: 'artifact-event',
        principalId: 'workspace-human',
        credentialId: 'private-credential',
        policyVersions: [],
        modelAlias: 'chat',
      });
      const headers = { authorization: `Bearer ${token}` };
      const audit = await fetch(`${origin}/management/v1/audit?model=chat`, { headers });
      assert.equal(audit.status, 200);
      const history = (await audit.json()) as { data: { requestId: string }[] };
      assert.equal(history.data.length, 1);
      assert.equal(history.data[0]?.requestId, 'artifact-event');
      assert.equal(accessEvents.at(-1)?.outcome, 'ready');
      const csv = await fetch(`${origin}/management/v1/audit?format=csv`, { headers });
      assert.equal(csv.status, 200);
      assert.match(await csv.text(), /artifact-event/);
      assert.equal(csv.headers.get('cache-control'), 'no-store');
      failAudit = true;
      const withheld = await fetch(`${origin}/management/v1/audit`, { headers });
      assert.equal(withheld.status, 503);
      assert.doesNotMatch(await withheld.text(), /artifact-event|private writer/);
      failAudit = false;
      await db.exec('DELETE FROM iam_principal_policies');
      const deniedAudit = await fetch(`${origin}/management/v1/audit`, { headers });
      assert.equal(deniedAudit.status, 403);
      await deniedAudit.text();
      assert.equal(accessEvents.at(-1)?.outcome, 'forbidden');
      const events = await db.query(
        'SELECT outcome,principal_id FROM sso_current_principal_audit_events',
      );
      assert.deepEqual(events.rows, [{ outcome: 'ready', principal_id: 'workspace-human' }]);
      await db.exec('DELETE FROM iam_sso_identity_bindings');
      const revoked = await fetch(`${origin}/management/v1/me`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(revoked.status, 401);
      await revoked.text();
      const models = await fetch(`${origin}/management/v1/models`);
      assert.equal(models.status, 401);
      await models.text();
      const denied = await fetch(`${origin}/management/v1/proxy-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(denied.status, 401);
      assert.equal((await fetch(`${origin}/api/v1/models`)).status, 404);
    } finally {
      await runtime.close();
      await runtime.close();
    }
    assert.equal(opens, 1);
    assert.equal(closes, 1);
  } finally {
    if (!closes) await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('bad artifacts fail before acquiring a database, with sanitized diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-browser-invalid-'));
  let opens = 0;
  try {
    const paths = ['empty', 'whitespace', 'invalid', 'nul', 'oversized', 'directory', 'missing'];
    await writeFile(join(directory, 'empty'), '');
    await writeFile(join(directory, 'whitespace'), '   \n');
    await writeFile(join(directory, 'invalid'), Buffer.from([0xc3, 0x28]));
    await writeFile(join(directory, 'nul'), 'export default "\0";');
    await writeFile(join(directory, 'oversized'), Buffer.alloc(8 * 1024 * 1024 + 1, 65));
    await mkdir(join(directory, 'directory'));
    for (const path of [...paths.map((name) => join(directory, name)), 'relative.js', '', null]) {
      await assert.rejects(
        startPostgresSsoWorkspaceBrowserGateway({
          ...sso.config,
          host: '127.0.0.1',
          port: 0,
          newRequestId: () => 'artifact-invalid',
          browserArtifactPath: path as string,
          openConnection: () => {
            opens++;
            throw new Error('must not connect');
          },
        }),
        {
          name: 'ManagementBrowserArtifactUnavailable',
          message: 'Management browser artifact unavailable',
        },
      );
    }
    assert.equal(opens, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
