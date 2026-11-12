import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoCanonicalReviewBrowserGateway } from '../src/gateway/postgres-sso-browser-bootstrap.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
const pin = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

test('reviewed catalog bundle and canonical signed APIs share an owned read-only listener', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-canonical-artifact-'));
  const artifact = join(directory, 'app.js');
  const db = new PGlite();
  let opens = 0;
  let closes = 0;
  let runtime:
    | Awaited<ReturnType<typeof startPostgresSsoCanonicalReviewBrowserGateway>>
    | undefined;
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
    const build = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/build-management-browser.ts',
        'src/management/catalog-entry.ts',
        '--output',
        artifact,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(build.status, 0, build.stderr);
    const javascript = await readFile(artifact, 'utf8');
    runtime = await startPostgresSsoCanonicalReviewBrowserGateway({
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      newRequestId: () => 'canonical-artifact',
      browserArtifactPath: artifact,
      browserArtifactSha256: pin(javascript),
      openConnection: () => {
        opens++;
        return connection;
      },
      ...({
        javascript: 'unverified caller script',
        browserJavascript: 'other script',
        audit: () => {
          throw new Error('untrusted override');
        },
      } as object),
    });
    await db.exec(`
      INSERT INTO iam_principals VALUES ('human','human',true);
      INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider"],"resources":["model:*","provider:openai"]},{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human','reader');
      INSERT INTO catalog_models (alias,created_at_seconds,enabled) VALUES ('chat',42,true);
      INSERT INTO catalog_routes (route_id,alias,kind,version,credential_ref,candidates) VALUES ('direct','chat','managed','v1',NULL,'[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-upstream"}]');
      UPDATE catalog_models SET active_route_id='direct' WHERE alias='chat';
    `);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const origin = `http://127.0.0.1:${runtime.address.port}`;
    const get = (path: string) =>
      fetch(origin + path, { headers: { authorization: `Bearer ${token}` } });
    const shell = await fetch(`${origin}/management`);
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /src="\/management\/app.js"/u);
    await writeFile(artifact, 'replaced release file');
    const script = await fetch(`${origin}/management/app.js`);
    assert.equal(script.status, 200);
    assert.equal(script.headers.get('cache-control'), 'no-store');
    assert.equal(await script.text(), javascript);
    const list = await get('/management/v1/models');
    assert.equal(list.status, 200);
    assert.equal(JSON.parse(await list.text()).data[0].id, 'chat');
    const detail = await get('/management/v1/models/chat');
    assert.equal(detail.status, 200);
    assert.equal(JSON.parse(await detail.text()).id, 'chat');
    for (const resource of ['usage', 'audit']) {
      const response = await get(`/management/v1/${resource}`);
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse(await response.text()).data, []);
      const csv = await get(`/management/v1/${resource}?format=csv`);
      assert.equal(csv.status, 200);
      assert.match(csv.headers.get('content-type') ?? '', /^text\/csv/u);
      assert.equal(csv.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(await csv.text(), /private-upstream|Bearer/u);
    }
    assert.equal(
      (
        await fetch(`${origin}/management/v1/models`, {
          headers: { cookie: 'session=not-authority' },
        })
      ).status,
      401,
    );
    for (const path of ['/management/v1/proxy-tokens', '/v1/models', '/v1/chat/completions'])
      assert.equal((await get(path)).status, 404);
    await db.exec('DROP TABLE sso_audit_history_access_events');
    const failure = await get('/management/v1/audit');
    assert.equal(failure.status, 503);
    assert.doesNotMatch(await failure.text(), /SELECT|INSERT|private-upstream/u);
    assert.equal(opens, 1);
    const closing = runtime.close();
    assert.equal(runtime.close(), closing);
    await closing;
    assert.equal(closes, 1);
    await assert.rejects(fetch(`${origin}/management`));
  } finally {
    await runtime?.close();
    if (!closes) await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('required exact pin and valid file are checked before SQL ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-canonical-pin-'));
  const artifact = join(directory, 'app.js');
  let opens = 0;
  const reject = async (path: string, expected: unknown) => {
    await assert.rejects(
      async () => {
        const unexpected = await startPostgresSsoCanonicalReviewBrowserGateway({
          ...jwt.config,
          host: '127.0.0.1',
          port: 0,
          newRequestId: () => 'invalid-pin',
          browserArtifactPath: path,
          browserArtifactSha256: expected as string,
          openConnection: () => {
            opens++;
            throw new Error('must not connect');
          },
        });
        await unexpected.close();
      },
      {
        name: 'ManagementBrowserArtifactUnavailable',
        message: 'Management browser artifact unavailable',
      },
    );
  };
  try {
    await writeFile(artifact, 'console.log("管理");');
    for (const expected of [undefined, null, '', 'A'.repeat(64), 'a'.repeat(63), '0'.repeat(64)])
      await reject(artifact, expected);
    await reject('relative.js', pin('anything'));
    await reject(join(directory, 'missing'), pin('anything'));
    for (const bytes of [
      Buffer.from([0xc3, 0x28]),
      Buffer.from(' \n'),
      Buffer.from('\0'),
      Buffer.alloc(8 * 1024 * 1024 + 1, 65),
    ]) {
      await writeFile(artifact, bytes);
      await reject(artifact, pin(bytes));
    }
    assert.equal(opens, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
