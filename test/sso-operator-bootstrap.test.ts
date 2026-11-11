import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadSsoBrowserBootstrap } from '../src/gateway/sso-operator-bootstrap.ts';
import { createRfc9068SsoAccessTokenVerifier } from '../src/identity/rfc9068-sso-access-tokens.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('operator bootstrap validates local public trust and defers PostgreSQL ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-sso-operator-'));
  const jwt = await createSsoAccessTokenFixture();
  const path = join(directory, 'jwks.json');
  const env = {
    OPENGRANTER_SSO_ISSUER: jwt.issuer,
    OPENGRANTER_SSO_AUDIENCE: jwt.audience,
    OPENGRANTER_SSO_JWKS_PATH: path,
    OPENGRANTER_BROWSER_ARTIFACT_PATH: join(directory, 'app.js'),
  };
  let opened = 0;
  const connection: PostgresConnection = {
    query: async () => ({ rows: [] }),
    transaction: async () => {
      throw new Error('not used');
    },
    close: async () => {},
  };
  try {
    await writeFile(path, JSON.stringify(jwt.config.jwks));
    const ports = await loadSsoBrowserBootstrap(env, () => {
      opened++;
      return connection;
    });
    assert.equal(opened, 0);
    assert.equal(ports.enableHistoryReads, undefined);
    for (const [value, expected] of [
      ['true', true],
      ['false', false],
    ] as const) {
      const configured = await loadSsoBrowserBootstrap(
        { ...env, OPENGRANTER_SSO_HISTORY_READS: value },
        () => connection,
      );
      assert.equal(configured.enableHistoryReads, expected);
    }
    assert.equal(ports.issuer, jwt.issuer);
    assert.equal(ports.audience, jwt.audience);
    assert.equal(ports.browserArtifactPath, env.OPENGRANTER_BROWSER_ARTIFACT_PATH);
    assert.equal(await ports.openConnection(), connection);
    assert.equal(opened, 1);
    // File replacement cannot change a running process's trust snapshot.
    await writeFile(path, '{"keys":[]}');
    const verifier = createRfc9068SsoAccessTokenVerifier({ ...ports, now: jwt.config.now });
    assert.deepEqual(await verifier(await jwt.token()), {
      issuer: jwt.issuer,
      subject: jwt.subject,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('operator bootstrap rejects missing configuration and unsafe trust with redacted diagnostics before DB', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-sso-operator-'));
  const jwt = await createSsoAccessTokenFixture();
  const path = join(directory, 'jwks.json');
  const env = {
    OPENGRANTER_SSO_ISSUER: jwt.issuer,
    OPENGRANTER_SSO_AUDIENCE: jwt.audience,
    OPENGRANTER_SSO_JWKS_PATH: path,
    OPENGRANTER_BROWSER_ARTIFACT_PATH: join(directory, 'app.js'),
  };
  let opened = 0;
  const open = (): PostgresConnection => {
    opened++;
    throw new Error('must not open');
  };
  const reject = (input: NodeJS.ProcessEnv = env) =>
    assert.rejects(loadSsoBrowserBootstrap(input, open), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'SSO operator bootstrap unavailable');
      assert.equal(error.cause, undefined);
      assert.equal(String(error).includes(directory), false);
      return true;
    });
  try {
    await writeFile(path, JSON.stringify(jwt.config.jwks));
    for (const value of ['', 'TRUE', '1', ' true', 'false ', 'false\0']) {
      await reject({ ...env, OPENGRANTER_SSO_HISTORY_READS: value });
    }
    for (const name of Object.keys(env)) {
      const input: NodeJS.ProcessEnv = { ...env };
      delete input[name];
      await reject(input);
      await reject({ ...env, [name]: '' });
    }
    await reject({ ...env, OPENGRANTER_SSO_ISSUER: 'http://insecure.example' });
    await reject({ ...env, OPENGRANTER_SSO_AUDIENCE: 'bad\0audience' });
    await reject({ ...env, OPENGRANTER_SSO_JWKS_PATH: 'relative.json' });
    await reject({ ...env, OPENGRANTER_BROWSER_ARTIFACT_PATH: 'relative.js' });
    await reject({ ...env, OPENGRANTER_BROWSER_ARTIFACT_PATH: '/bad\0path' });
    await reject({ ...env, OPENGRANTER_SSO_JWKS_PATH: '/bad\0path' });
    await reject({ ...env, OPENGRANTER_SSO_JWKS_PATH: join(directory, 'missing.json') });
    for (const contents of [
      '',
      ' ',
      '{bad-public-trust',
      '{"keys":[]}',
      'x'.repeat(65537),
      Buffer.from([255]),
    ]) {
      await writeFile(path, contents);
      await reject();
    }
    await writeFile(path, JSON.stringify({ keys: [{ ...jwt.publicJwk, d: 'not-allowed' }] }));
    await reject();
    await rm(path);
    await mkdir(path);
    await reject();
    await rm(path, { recursive: true });
    const target = join(directory, 'public.json');
    await writeFile(target, JSON.stringify(jwt.config.jwks));
    await symlink(target, path);
    await reject();
    assert.equal(opened, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
