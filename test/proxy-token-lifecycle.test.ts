import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createAttachmentAuthenticator } from '../src/gateway/attachment-authenticator.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';

const migration = await readFile(
  new URL('../migrations/002_proxy_credentials.sql', import.meta.url),
  'utf8',
);

async function fixture() {
  const db = new PGlite();
  await db.exec(migration);
  let now = 1_000;
  const store = createPostgresProxyCredentialStore({
    query: (sql, params) => db.query(sql, [...params]),
  });
  const service = createProxyTokenService({ store, now: () => now });
  return {
    db,
    service,
    advance: (time: number) => {
      now = time;
    },
  };
}

const issueInput = {
  principalId: 'service-1',
  actorId: 'admin-1',
  requestId: 'issue-request-1',
  expiresAt: 10_000,
};

test('issue returns a one-time opaque token and verifies its attributed identity', async () => {
  const { db, service } = await fixture();
  try {
    const issued = await service.issue(issueInput);
    assert.match(issued.token, /^og1_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/u);
    assert.deepEqual(await service.verifyCredential(issued.token), {
      credentialId: issued.credentialId,
      principalId: 'service-1',
      active: true,
    });
    const rows = await db.query<{ token_digest: string; principal_id: string }>(
      'SELECT token_digest, principal_id FROM proxy_credentials',
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.principal_id, 'service-1');
    assert.match(rows.rows[0]?.token_digest ?? '', /^[a-f0-9]{64}$/u);
    const events = await db.query<{ action: string; actor_id: string; request_id: string }>(
      'SELECT action, actor_id, request_id FROM proxy_credential_events',
    );
    assert.deepEqual(events.rows, [
      { action: 'issued', actor_id: 'admin-1', request_id: 'issue-request-1' },
    ]);
    assert.equal(JSON.stringify(rows.rows).includes(issued.token), false);
    assert.equal(JSON.stringify(events.rows).includes(issued.token), false);
  } finally {
    await db.close();
  }
});

test('malformed, unknown, wrong-secret, expired, and revoked tokens deny access', async () => {
  const { db, service, advance } = await fixture();
  try {
    const issued = await service.issue(issueInput);
    assert.equal(await service.verifyCredential('bad-token'), undefined);
    assert.equal(
      await service.verifyCredential(`og1_${'A'.repeat(22)}_${'B'.repeat(43)}`),
      undefined,
    );
    const wrong = `${issued.token.slice(0, -1)}${issued.token.endsWith('A') ? 'B' : 'A'}`;
    assert.equal(await service.verifyCredential(wrong), undefined);
    advance(issueInput.expiresAt);
    assert.equal(await service.verifyCredential(issued.token), undefined);
    advance(2_000);
    assert.equal(
      await service.revoke({
        credentialId: issued.credentialId,
        actorId: 'admin-1',
        requestId: 'revoke-1',
      }),
      true,
    );
    assert.equal(
      await service.revoke({
        credentialId: issued.credentialId,
        actorId: 'admin-1',
        requestId: 'revoke-2',
      }),
      false,
    );
    assert.equal(await service.verifyCredential(issued.token), undefined);
    const events = await db.query<{ action: string; request_id: string }>(
      'SELECT action, request_id FROM proxy_credential_events ORDER BY event_id',
    );
    assert.deepEqual(events.rows, [
      { action: 'issued', request_id: 'issue-request-1' },
      { action: 'revoked', request_id: 'revoke-1' },
    ]);
  } finally {
    await db.close();
  }
});

test('issue validates identity and expiry before writing a credential', async () => {
  const { db, service } = await fixture();
  try {
    await assert.rejects(service.issue({ ...issueInput, principalId: '', expiresAt: 10_000 }), {
      name: 'InvalidProxyCredentialInput',
    });
    await assert.rejects(service.issue({ ...issueInput, expiresAt: 1_000 }), {
      name: 'InvalidProxyCredentialInput',
    });
    const rows = await db.query('SELECT credential_id FROM proxy_credentials');
    assert.equal(rows.rows.length, 0);
  } finally {
    await db.close();
  }
});

test('failed issuance audit rolls back the credential and never discloses a token', async () => {
  const { db, service } = await fixture();
  try {
    await db.exec('DROP TABLE proxy_credential_events');
    await assert.rejects(service.issue(issueInput), (error: unknown) => {
      assert.equal((error as Error).name, 'ProxyCredentialUnavailable');
      assert.equal((error as Error).message, 'Proxy credential store unavailable');
      return true;
    });
    const rows = await db.query('SELECT credential_id FROM proxy_credentials');
    assert.equal(rows.rows.length, 0);
  } finally {
    await db.close();
  }
});

test('failed revocation audit rolls back revocation', async () => {
  const { db, service } = await fixture();
  try {
    const issued = await service.issue(issueInput);
    await db.exec('DROP TABLE proxy_credential_events');
    await assert.rejects(
      service.revoke({
        credentialId: issued.credentialId,
        actorId: 'admin-1',
        requestId: 'revoke-1',
      }),
      { name: 'ProxyCredentialUnavailable', message: 'Proxy credential store unavailable' },
    );
    assert.deepEqual(await service.verifyCredential(issued.token), {
      credentialId: issued.credentialId,
      principalId: 'service-1',
      active: true,
    });
  } finally {
    await db.close();
  }
});

test('database read failures are safe availability errors', async () => {
  const { db, service } = await fixture();
  try {
    const issued = await service.issue(issueInput);
    await db.exec('DROP TABLE proxy_credentials CASCADE');
    await assert.rejects(service.verifyCredential(issued.token), {
      name: 'ProxyCredentialUnavailable',
      message: 'Proxy credential store unavailable',
    });
  } finally {
    await db.close();
  }
});

test('issued tokens connect to attachment authentication and stop after revocation', async () => {
  const { db, service } = await fixture();
  try {
    const issued = await service.issue(issueInput);
    const authenticate = createAttachmentAuthenticator({
      verifyCredential: service.verifyCredential,
      loadSnapshot: async () => ({
        principal: {
          id: 'service-1',
          kind: 'service',
          active: true,
          directPolicyIds: ['invoke'],
          roleIds: [],
        },
        roles: [],
        policies: [
          {
            id: 'invoke',
            version: 'v1',
            statements: [
              {
                effect: 'Allow',
                actions: ['llm:InvokeModel'],
                resources: ['model:chat'],
              },
            ],
          },
        ],
      }),
    });
    const identity = await authenticate(issued.token);
    assert.equal(identity?.id, 'service-1');
    assert.equal(identity?.credentialId, issued.credentialId);
    await service.revoke({
      credentialId: issued.credentialId,
      actorId: 'admin-1',
      requestId: 'revoke-1',
    });
    assert.equal(await authenticate(issued.token), undefined);
  } finally {
    await db.close();
  }
});
