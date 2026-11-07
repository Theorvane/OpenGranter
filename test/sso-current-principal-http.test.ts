import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { request as nodeRequest } from 'node:http';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresRfc9068SsoCurrentPrincipalHandler as createHandler,
  createPostgresRfc9068SsoCurrentPrincipalServer,
} from '../src/gateway/postgres-sso-current-principal-http.ts';
import {
  type CurrentPrincipalAuditEvent,
  createSsoCurrentPrincipalHandler,
} from '../src/gateway/sso-current-principal-http.ts';
import { SsoManagementUnauthenticated } from '../src/identity/postgres-sso-human-authentication.ts';
import { InvalidSsoAccessTokenConfiguration } from '../src/identity/rfc9068-sso-access-tokens.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
const path = '/management/v1/principal';
function request(authorization = `Bearer ${token}`) {
  return new Request(`http://localhost${path}`, { headers: { authorization } });
}
test('signed JWT and current migrated human binding expose only own identity after audit', async () => {
  const db = new PGlite();
  try {
    for (const name of ['004_iam_snapshots.sql', '011_sso_identity_bindings.sql'])
      await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    await db.exec("INSERT INTO iam_principals VALUES ('human-current','human',true)");
    await db.query(
      'INSERT INTO iam_sso_identity_bindings (issuer,subject,principal_id) VALUES ($1,$2,$3)',
      [jwt.issuer, jwt.subject, 'human-current'],
    );
    const events: unknown[] = [];
    const ports = {
      ...jwt.config,
      client: { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) },
      newRequestId: () => 'server-1',
      writeAudit: async (event: unknown) => {
        events.push(event);
      },
    };
    const handler = createHandler(ports);
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: 'human-current', kind: 'human' });
    assert.deepEqual(events, [
      { requestId: 'server-1', outcome: 'ready', principalId: 'human-current' },
    ]);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human-current'");
    await error(await handler(request()), 401, 'unauthorized');
    await db.exec(
      "INSERT INTO iam_principals VALUES ('human-next','human',true),('service-test','service',true)",
    );
    await db.exec("UPDATE iam_sso_identity_bindings SET principal_id='human-next'");
    assert.deepEqual(await (await handler(request())).json(), { id: 'human-next', kind: 'human' });
    await db.exec("UPDATE iam_sso_identity_bindings SET principal_id='service-test'");
    await error(await handler(request()), 401, 'unauthorized');
    await db.exec('DELETE FROM iam_sso_identity_bindings');
    await error(await handler(request()), 401, 'unauthorized');
    assert.deepEqual(events.slice(1), [
      { requestId: 'server-1', outcome: 'unauthenticated', principalId: null },
      { requestId: 'server-1', outcome: 'ready', principalId: 'human-next' },
      { requestId: 'server-1', outcome: 'unauthenticated', principalId: null },
      { requestId: 'server-1', outcome: 'unauthenticated', principalId: null },
    ]);
    for (const rejected of [
      await jwt.token({ exp: jwt.nowSeconds - 1 }),
      await jwt.token({ aud: 'urn:wrong' }),
      await jwt.token({ iss: 'https://unregistered.example' }),
      await jwt.token({ sub: 'not-bound' }),
      await jwt.token({}, { kid: 'unknown' }),
    ])
      await error(await handler(request(`Bearer ${rejected}`)), 401, 'unauthorized');
    const broken = createHandler({
      ...ports,
      client: {
        query: async () => {
          throw new Error('PRIVATE SQL');
        },
      },
    });
    await error(await broken(request()), 503, 'authentication_unavailable');
    const deniedAudit = createHandler({
      ...ports,
      writeAudit: async () => {
        throw new Error('PRIVATE AUDIT');
      },
    });
    await error(await deniedAudit(request()), 503, 'audit_unavailable');
    const overridePorts = {
      ...ports,
      authenticate: async () => 'forged',
      verifyAccessToken: async () => ({ issuer: jwt.issuer, subject: jwt.subject }),
    };
    const noOverride = createHandler(overridePorts);
    await error(await noOverride(request('Bearer invalid')), 401, 'unauthorized');
    const server = createPostgresRfc9068SsoCurrentPrincipalServer(ports);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}${path}`;
      await db.query(
        'INSERT INTO iam_sso_identity_bindings (issuer,subject,principal_id) VALUES ($1,$2,$3)',
        [jwt.issuer, jwt.subject, 'human-next'],
      );
      const actual = await fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          'x-principal-id': 'forged',
          'x-request-id': 'forged',
        },
      });
      assert.deepEqual(await actual.json(), { id: 'human-next', kind: 'human' });
      assert.equal(actual.headers.get('x-request-id'), 'server-1');
      await error(
        await fetch(url, { headers: { cookie: 'session=not-authority' } }),
        401,
        'unauthorized',
      );
      const framed = await new Promise<number | undefined>((resolve, reject) => {
        const req = nodeRequest(
          url,
          { method: 'GET', headers: { authorization: `Bearer ${token}`, 'content-length': '2' } },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
      assert.equal(framed, 400);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  } finally {
    await db.close();
  }
});

async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  if (status === 401) assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  const text = await response.text();
  assert.equal(JSON.parse(text).error.code, code);
  for (const secret of ['PRIVATE', token, 'forged']) assert.equal(text.includes(secret), false);
}
function fixture() {
  const events: CurrentPrincipalAuditEvent[] = [];
  const tokens: string[] = [];
  const ports = {
    newRequestId: () => 'server-request',
    authenticate: async (accessToken: string): Promise<string> => {
      tokens.push(accessToken);
      return 'human-self';
    },
    writeAudit: async (event: CurrentPrincipalAuditEvent): Promise<void> => {
      events.push(event);
    },
  };
  return { ports, events, tokens };
}
test('valid Bearer is passed once; own identity projection ignores caller principal, cookie and request ID', async () => {
  const f = fixture();
  const handler = createSsoCurrentPrincipalHandler(f.ports);
  const req = request('bEaReR PRIVATE-TOKEN');
  req.headers.set('x-principal-id', 'forged');
  req.headers.set('cookie', 'session=forged');
  req.headers.set('x-request-id', 'forged');
  const response = await handler(req);
  assert.deepEqual(await response.json(), { id: 'human-self', kind: 'human' });
  assert.deepEqual(f.tokens, ['PRIVATE-TOKEN']);
  assert.deepEqual(f.events, [
    { requestId: 'server-request', outcome: 'ready', principalId: 'human-self' },
  ]);
  assert.equal(Object.isFrozen(f.events[0]), true);
});
for (const authorization of ['', 'Basic PRIVATE', 'Bearer', 'Bearer x,y', 'Bearer x y']) {
  test(`malformed authorization never yields an identity: ${authorization.split(' ')[0]}`, async () => {
    const f = fixture();
    f.ports.authenticate = async (accessToken) => {
      f.tokens.push(accessToken);
      throw new SsoManagementUnauthenticated();
    };
    await error(
      await createSsoCurrentPrincipalHandler(f.ports)(request(authorization)),
      401,
      'unauthorized',
    );
    assert.deepEqual(f.tokens, ['']);
    assert.deepEqual(f.events, [
      { requestId: 'server-request', outcome: 'unauthenticated', principalId: null },
    ]);
  });
}
for (const principal of ['', 'x'.repeat(257), 'PRIVATE\u0000', 'x\uD800', 'x\u0085']) {
  test('malformed trusted identity is unavailable with no leaked ID', async () => {
    const f = fixture();
    f.ports.authenticate = async () => principal;
    await error(
      await createSsoCurrentPrincipalHandler(f.ports)(request()),
      503,
      'authentication_unavailable',
    );
    assert.equal(f.events[0]?.principalId, null);
  });
}
test('missing bearer cannot become authenticated through permissive injected port', async () => {
  const f = fixture();
  await error(
    await createSsoCurrentPrincipalHandler(f.ports)(request('')),
    503,
    'authentication_unavailable',
  );
  assert.equal(f.events[0]?.principalId, null);
});
for (const outcome of ['ready', 'unauthenticated', 'unavailable'] as const) {
  test(`audit failure suppresses ${outcome} response`, async () => {
    const f = fixture();
    if (outcome !== 'ready')
      f.ports.authenticate = async () => {
        throw outcome === 'unauthenticated'
          ? new SsoManagementUnauthenticated()
          : new Error('PRIVATE');
      };
    f.ports.writeAudit = async () => {
      throw new Error('PRIVATE AUDIT');
    };
    await error(
      await createSsoCurrentPrincipalHandler(f.ports)(request()),
      503,
      'audit_unavailable',
    );
  });
}
test('pending required audit blocks response; abort suppresses identity after append', async () => {
  const f = fixture();
  let release = () => {};
  let started = () => {};
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.ports.writeAudit = async (event) => {
    f.events.push(event);
    started();
    await pending;
  };
  const controller = new AbortController();
  const req = new Request(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  let settled = false;
  const response = createSsoCurrentPrincipalHandler(f.ports)(req).then((value) => {
    settled = true;
    return value;
  });
  await entered;
  await Promise.resolve();
  assert.equal(settled, false);
  controller.abort();
  release();
  await error(await response, 400, 'invalid_request');
  assert.equal(f.events[0]?.outcome, 'ready');
});
for (const headers of [
  { 'content-length': '1' },
  { 'content-length': '00' },
  { 'content-length': 'invalid' },
  { 'transfer-encoding': 'chunked' },
]) {
  test('GET framing is rejected before authentication or audit', async () => {
    const f = fixture();
    const req = request();
    for (const [key, value] of Object.entries(headers)) req.headers.set(key, value);
    await error(await createSsoCurrentPrincipalHandler(f.ports)(req), 400, 'invalid_request');
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.tokens, []);
  });
}
test('query, abort and actual Request body reject before private work', async () => {
  const f = fixture();
  const handler = createSsoCurrentPrincipalHandler(f.ports);
  const controller = new AbortController();
  controller.abort();
  const body = request();
  Object.defineProperty(body, 'body', {
    value: new ReadableStream({
      start(c) {
        c.close();
      },
    }),
  });
  for (const req of [
    new Request(`http://localhost${path}?principal=forged`),
    new Request(`http://localhost${path}`, { signal: controller.signal }),
    body,
  ])
    await error(await handler(req), 400, 'invalid_request');
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.tokens, []);
});
test('unknown route/method has no request ID allocation or private work', async () => {
  const f = fixture();
  f.ports.newRequestId = () => {
    throw new Error('PRIVATE');
  };
  const handler = createSsoCurrentPrincipalHandler(f.ports);
  for (const req of [
    new Request(`http://localhost${path}/human`),
    new Request(`http://localhost${path}`, { method: 'POST' }),
    new Request('http://localhost/api/v1/models'),
  ])
    await error(await handler(req), 404, 'not_found');
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.tokens, []);
});
for (const id of ['', 'x'.repeat(257), 'bad id', 'bad\n']) {
  test('invalid generated request ID cannot reach authentication/audit', async () => {
    const f = fixture();
    f.ports.newRequestId = () => id;
    await error(await createSsoCurrentPrincipalHandler(f.ports)(request()), 503, 'internal_error');
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.tokens, []);
  });
}
test('ports captured once and content-length zero accepted', async () => {
  const f = fixture();
  const handler = createSsoCurrentPrincipalHandler(f.ports);
  f.ports.authenticate = async () => {
    throw new Error('PRIVATE replacement');
  };
  f.ports.writeAudit = async () => {
    throw new Error('PRIVATE replacement');
  };
  f.ports.newRequestId = () => {
    throw new Error('PRIVATE replacement');
  };
  const req = request();
  req.headers.set('content-length', '0');
  assert.equal((await handler(req)).status, 200);
  assert.equal(f.events.length, 1);
});
test('trusted PostgreSQL configuration requires durable audit port and fixed registered-key profile', () => {
  const f = fixture();
  const ports = {
    ...jwt.config,
    client: { query: async () => ({ rows: [] }) },
    newRequestId: f.ports.newRequestId,
    writeAudit: f.ports.writeAudit,
  };
  for (const broken of [
    { ...ports, writeAudit: undefined },
    { ...ports, newRequestId: undefined },
    { ...ports, client: null },
    { ...ports, jwks: [] },
  ])
    assert.throws(
      () => createHandler(broken as unknown as Parameters<typeof createHandler>[0]),
      InvalidSsoAccessTokenConfiguration,
    );
  assert.throws(
    () =>
      createSsoCurrentPrincipalHandler({
        ...f.ports,
        writeAudit: undefined,
      } as unknown as Parameters<typeof createSsoCurrentPrincipalHandler>[0]),
    /Invalid current principal HTTP configuration/,
  );
});

test('authentication infrastructure failure is audited without underlying details', async () => {
  const f = fixture();
  f.ports.authenticate = async () => {
    throw new Error('PRIVATE SQL');
  };
  await error(
    await createSsoCurrentPrincipalHandler(f.ports)(request()),
    503,
    'authentication_unavailable',
  );
  assert.deepEqual(f.events, [
    { requestId: 'server-request', outcome: 'unavailable', principalId: null },
  ]);
});
test('abort during authentication still awaits safe audit and suppresses identity', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.ports.authenticate = async () => {
    controller.abort();
    return 'human-self';
  };
  const req = new Request(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  await error(await createSsoCurrentPrincipalHandler(f.ports)(req), 400, 'invalid_request');
  assert.equal(f.events.length, 1);
});
