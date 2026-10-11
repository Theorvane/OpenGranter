import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as nodeRequest } from 'node:http';
import { test } from 'node:test';
import {
  createSsoManagementHandler,
  createSsoManagementServer,
} from '../src/gateway/sso-management-http.ts';
import {
  InvalidTokenManagementLifetime,
  TokenManagementDenied,
  TokenManagementUnavailable,
} from '../src/gateway/token-management.ts';
import {
  SsoManagementAuthenticationUnavailable,
  SsoManagementUnauthenticated,
} from '../src/identity/postgres-sso-human-authentication.ts';

const paths = {
  issue: '/management/v1/proxy-tokens',
  revoke: '/management/v1/proxy-tokens/revoke',
};
const bodies = {
  issue: { principalId: 'target', expiresAt: 10000 },
  revoke: { credentialId: 'credential' },
};
type Ports = Parameters<typeof createSsoManagementHandler>[0];
function fixture(patch: Partial<Ports> = {}) {
  const calls: string[] = [];
  const inputs: unknown[] = [];
  const events: unknown[] = [];
  const ports: Ports = {
    newRequestId: () => 'server-id',
    authenticate: async (token) => {
      calls.push('authenticate');
      assert.equal(token, 'opaque-SSO-token');
      return 'bound-human';
    },
    issue: async (input) => {
      calls.push('issue');
      inputs.push(input);
      return { credentialId: 'credential', token: 'one-time-token', private: 'excluded' };
    },
    revoke: async (input) => {
      calls.push('revoke');
      inputs.push(input);
      return true;
    },
    writeAudit: async (event) => {
      calls.push('audit');
      events.push(event);
    },
    ...patch,
  };
  return { handler: createSsoManagementHandler(ports), ports, calls, inputs, events };
}
function request(
  operation: 'issue' | 'revoke',
  body: unknown = bodies[operation],
  authorization: string | null = 'Bearer opaque-SSO-token',
) {
  return new Request(`http://localhost${paths[operation]}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'caller-id',
      ...(authorization === null ? {} : { authorization }),
    },
    body: JSON.stringify(body),
  });
}
async function checkError(
  response: Response,
  status: number,
  code: string,
  ...ids: readonly (string | undefined)[]
) {
  const requestId = ids.length === 0 ? 'server-id' : ids[0];
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), requestId ?? null);
  const value = (await response.json()) as {
    error: { code: string; message: string };
    request_id?: string;
  };
  assert.equal(value.error.code, code);
  assert.equal(value.request_id, requestId);
  assert.equal(JSON.stringify(value).includes('private'), false);
  return value;
}
for (const operation of ['issue', 'revoke'] as const) {
  test(`${operation} projects success with a derived actor and server ID`, async () => {
    const f = fixture();
    const response = await f.handler(request(operation));
    assert.equal(response.status, operation === 'issue' ? 201 : 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-request-id'), 'server-id');
    assert.deepEqual(
      await response.json(),
      operation === 'issue'
        ? { credentialId: 'credential', token: 'one-time-token' }
        : { revoked: true },
    );
    assert.deepEqual(f.calls, ['authenticate', operation]);
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.inputs, [
      { authenticatedActorId: 'bound-human', requestId: 'server-id', ...bodies[operation] },
    ]);
  });
  for (const header of [null, '', 'Basic private-token', 'Bearer', 'Bearer x y', 'Bearer x,y']) {
    test(`${operation} malformed Bearer cannot read body: ${header}`, async () => {
      const f = fixture();
      const req = request(operation, bodies[operation], header);
      Object.defineProperty(req, 'body', {
        get() {
          throw Error('body consumed before authentication');
        },
      });
      const response = await f.handler(req);
      await checkError(response, 401, 'unauthorized');
      assert.equal(response.headers.get('www-authenticate'), 'Bearer');
      assert.deepEqual(f.calls, ['audit']);
      assert.deepEqual(f.events, [
        { kind: 'management-auth-denied', requestId: 'server-id', operation },
      ]);
    });
  }
  for (const [label, error, status, code, kind] of [
    [
      'unregistered',
      new SsoManagementUnauthenticated(),
      401,
      'unauthorized',
      'management-auth-denied',
    ],
    [
      'dependency',
      new SsoManagementAuthenticationUnavailable(),
      503,
      'authentication_unavailable',
      'management-auth-unavailable',
    ],
    [
      'unexpected',
      Error('private-token-and-claims'),
      503,
      'authentication_unavailable',
      'management-auth-unavailable',
    ],
    [
      'spoofed error name',
      Object.assign(Error('private-token'), { name: 'SsoManagementUnauthenticated' }),
      503,
      'authentication_unavailable',
      'management-auth-unavailable',
    ],
  ] as const) {
    test(`${operation} auth ${label} is anonymous and precedes malformed body`, async () => {
      const f = fixture({
        authenticate: async () => {
          throw error;
        },
      });
      const req = request(operation);
      Object.defineProperty(req, 'body', {
        get() {
          throw Error('body must remain unread');
        },
      });
      await checkError(await f.handler(req), status, code);
      assert.deepEqual(f.events, [{ kind, requestId: 'server-id', operation }]);
      assert.deepEqual(f.inputs, []);
    });
    test(`${operation} required auth audit failure overrides ${label}`, async () => {
      const f = fixture({
        authenticate: async () => {
          throw error;
        },
        writeAudit: async () => {
          throw Error('private-audit');
        },
      });
      await checkError(await f.handler(request(operation)), 503, 'audit_unavailable');
      assert.deepEqual(f.inputs, []);
    });
  }
  for (const body of [
    null,
    [],
    {},
    { ...bodies[operation], actorId: 'forged' },
    { ...bodies[operation], authenticatedActorId: 'forged' },
    { ...bodies[operation], requestId: 'caller' },
    { ...bodies[operation], extra: 1 },
    ...(operation === 'issue'
      ? [
          { principalId: '', expiresAt: 1 },
          { principalId: 'x\0y', expiresAt: 1 },
          { principalId: '\ud800', expiresAt: 1 },
          { principalId: 'x'.repeat(257), expiresAt: 1 },
          { principalId: 'target', expiresAt: -1 },
          { principalId: 'target', expiresAt: 0.5 },
          { principalId: 'target', expiresAt: '10000' },
          { principalId: 'target', expiresAt: 9007199254740992 },
        ]
      : [
          { credentialId: '' },
          { credentialId: '\udfff' },
          { credentialId: 'x\0y' },
          { credentialId: 'x'.repeat(257) },
        ]),
  ]) {
    test(`${operation} rejects malformed/forged body ${JSON.stringify(body).slice(0, 90)}`, async () => {
      const f = fixture();
      await checkError(await f.handler(request(operation, body)), 400, 'invalid_request');
      assert.deepEqual(f.calls, ['authenticate']);
      assert.deepEqual(f.inputs, []);
      assert.deepEqual(f.events, []);
    });
  }
  for (const [label, bytes, contentType] of [
    ['invalid JSON', new TextEncoder().encode('{private-body'), 'application/json'],
    ['invalid UTF8', new Uint8Array([0xc3, 0x28]), 'application/json'],
    ['truncated UTF8', new Uint8Array([0xe2, 0x82]), 'application/json'],
    ['oversized', new TextEncoder().encode(' '.repeat(16385)), 'application/json'],
    ['multibyte limit', new TextEncoder().encode('é'.repeat(8193)), 'application/json'],
    ['wrong media', new TextEncoder().encode(JSON.stringify(bodies[operation])), 'text/plain'],
  ] as const) {
    test(`${operation} bounded parser rejects ${label}`, async () => {
      const f = fixture();
      const req = new Request(`http://localhost${paths[operation]}`, {
        method: 'POST',
        headers: { authorization: 'Bearer opaque-SSO-token', 'content-type': contentType },
        body: bytes,
      });
      await checkError(await f.handler(req), 400, 'invalid_request');
      assert.deepEqual(f.calls, ['authenticate']);
    });
  }
  for (const error of [
    new TokenManagementDenied(),
    new TokenManagementUnavailable(),
    Error('private-driver'),
    Object.assign(Error('private-details'), { name: 'TokenManagementDenied' }),
  ]) {
    test(`${operation} management error ${error.name} remains safe`, async () => {
      const fail = async () => {
        throw error;
      };
      const f = fixture({ issue: fail, revoke: fail });
      await checkError(
        await f.handler(request(operation)),
        error instanceof TokenManagementDenied ? 403 : 503,
        error instanceof TokenManagementDenied ? 'forbidden' : 'internal_error',
      );
      assert.deepEqual(f.events, []);
    });
  }
}

test('only issue lifetime validation maps to 400; revoke errors stay unavailable', async () => {
  const fail = async () => {
    throw new InvalidTokenManagementLifetime();
  };
  const f = fixture({ issue: fail, revoke: fail });
  await checkError(await f.handler(request('issue')), 400, 'invalid_request');
  await checkError(await f.handler(request('revoke')), 503, 'internal_error');
});
test('already revoked result is false after invoking the trusted current-IAM service', async () => {
  const f = fixture({ revoke: async () => false });
  const response = await f.handler(request('revoke'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: false });
});
for (const value of ['', 'x'.repeat(257), 'private\nheader', '\ud800', null, 2]) {
  test(`invalid trusted request ID fails closed without reflection: ${String(value).slice(0, 20)}`, async () => {
    const f = fixture({ newRequestId: () => value as string });
    await checkError(await f.handler(request('issue')), 503, 'internal_error', undefined);
    assert.deepEqual(f.calls, []);
  });
}
test('trusted request ID generator throws a safe unavailable response', async () => {
  const f = fixture({
    newRequestId: () => {
      throw Error('private-id');
    },
  });
  await checkError(await f.handler(request('issue')), 503, 'internal_error', undefined);
});
for (const [path, method] of [
  ['/v1/chat/completions', 'POST'],
  [paths.issue, 'GET'],
  [`${paths.revoke}/`, 'POST'],
] as const) {
  test(`unknown route/method stays isolated and no-store: ${method}${path}`, async () => {
    const f = fixture();
    await checkError(
      await f.handler(new Request(`http://localhost${path}`, { method })),
      404,
      'not_found',
      undefined,
    );
    assert.deepEqual(f.calls, []);
  });
}
test('query rejection follows authentication and performs no management work', async () => {
  const f = fixture();
  const req = request('issue');
  await checkError(
    await f.handler(new Request(`${req.url}?actorId=forged`, req)),
    400,
    'invalid_request',
  );
  assert.deepEqual(f.calls, ['authenticate']);
});
test('body streams authenticate first, stop at the byte budget and cancel the reader', async () => {
  let cancelled = false;
  let pulls = 0;
  const f = fixture();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        assert.ok(f.calls.includes('authenticate'));
        pulls++;
        controller.enqueue(new Uint8Array(9000).fill(32));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const req = new Request(`http://localhost${paths.issue}`, {
    method: 'POST',
    headers: { authorization: 'Bearer opaque-SSO-token', 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  await checkError(await f.handler(req), 400, 'invalid_request');
  assert.equal(pulls, 2);
  assert.equal(cancelled, true);
  assert.deepEqual(f.calls, ['authenticate']);
});
test('parser accepts an exact 16KiB JSON body and split UTF8 characters', async () => {
  const f = fixture();
  const body = JSON.stringify({ ...bodies.issue, principalId: '人' });
  const bytes = new TextEncoder().encode(
    body + ' '.repeat(16384 - new TextEncoder().encode(body).length),
  );
  let i = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (i === bytes.length) {
          c.close();
          return;
        }
        c.enqueue(bytes.slice(i, i + 1));
        i++;
      },
    },
    { highWaterMark: 0 },
  );
  const response = await f.handler(
    new Request(`http://localhost${paths.issue}`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer opaque-SSO-token',
        'content-type': 'APPLICATION/JSON; charset=utf-8',
      },
      body: stream,
      duplex: 'half',
    } as RequestInit),
  );
  assert.equal(response.status, 201);
});
test('body read failure stays a safe 400 after authentication', async () => {
  const f = fixture();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        c.error(Error('private-body'));
      },
    },
    { highWaterMark: 0 },
  );
  await checkError(
    await f.handler(
      new Request(`http://localhost${paths.issue}`, {
        method: 'POST',
        headers: { authorization: 'Bearer opaque-SSO-token', 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    ),
    400,
    'invalid_request',
  );
  assert.deepEqual(f.calls, ['authenticate']);
});
for (const phase of ['before', 'authentication', 'body'] as const) {
  test(`cancellation ${phase} stops before mutation`, async () => {
    const abort = new AbortController();
    const f = fixture({
      authenticate: async () => {
        if (phase === 'authentication') abort.abort();
        return 'bound-human';
      },
    });
    if (phase === 'before') abort.abort();
    const req = new Request(request('issue'), { signal: abort.signal });
    if (phase === 'body') {
      const jsonBody = req.body;
      assert.ok(jsonBody);
      Object.defineProperty(req, 'body', {
        get() {
          abort.abort();
          return jsonBody;
        },
      });
    }
    await checkError(await f.handler(req), 400, 'invalid_request');
    assert.deepEqual(f.inputs, []);
  });
}
test('capture trusted ports before asynchronous authentication and project only expected output', async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const f = fixture({
    authenticate: async () => {
      await wait;
      return 'bound-human';
    },
  });
  const result = f.handler(request('issue'));
  Object.assign(f.ports, {
    issue: async () => {
      throw Error('private-replacement');
    },
    newRequestId: () => 'changed',
  });
  release();
  assert.equal((await result).status, 201);
  assert.equal(f.inputs.length, 1);
});
for (const result of [
  null,
  {},
  { credentialId: '', token: 'private' },
  { credentialId: 'credential', token: '' },
  { credentialId: 'credential', token: 'x\0y' },
]) {
  test(
    'malformed issuance result stays unavailable without a partial secret: ' +
      JSON.stringify(result),
    async () => {
      const f = fixture({ issue: async () => result as Awaited<ReturnType<Ports['issue']>> });
      await checkError(await f.handler(request('issue')), 503, 'internal_error');
    },
  );
}
for (const value of [null, 'false', {}, 0]) {
  test(`malformed revocation result cannot claim completion: ${JSON.stringify(value)}`, async () => {
    const f = fixture({ revoke: async () => value as boolean });
    await checkError(await f.handler(request('revoke')), 503, 'internal_error');
  });
}
test('unbound injected Node factory is available without opening a socket', () => {
  const f = fixture();
  const server = createSsoManagementServer(f.ports);
  assert.equal(server.listening, false);
  server.close();
});

for (const operation of ['issue', 'revoke'] as const) {
  test(`${operation} rejects wrong own keys with the correct field count`, async () => {
    const f = fixture();
    await checkError(
      await f.handler(
        request(
          operation,
          operation === 'issue' ? { principalId: 'target', wrong: 10000 } : { wrong: 'credential' },
        ),
      ),
      400,
      'invalid_request',
    );
    assert.deepEqual(f.inputs, []);
  });
  test(`${operation} maps a trusted invalid input error safely`, async () => {
    const { InvalidTokenManagementInput } = await import('../src/gateway/token-management.ts');
    const fail = async () => {
      throw new InvalidTokenManagementInput();
    };
    const f = fixture({ issue: fail, revoke: fail });
    await checkError(await f.handler(request(operation)), 400, 'invalid_request');
  });
}
for (const actor of [undefined, null, '', '\ud800', 'x'.repeat(257)]) {
  test(`malformed authentication result is unavailable with anonymous audit: ${String(actor).slice(0, 20)}`, async () => {
    const f = fixture({ authenticate: async () => actor as string });
    await checkError(await f.handler(request('issue')), 503, 'authentication_unavailable');
    assert.deepEqual(f.events, [
      { kind: 'management-auth-unavailable', requestId: 'server-id', operation: 'issue' },
    ]);
    assert.deepEqual(f.inputs, []);
  });
}
test('authenticated empty body rejects before management', async () => {
  const f = fixture();
  await checkError(
    await f.handler(
      new Request(`http://localhost${paths.issue}`, {
        method: 'POST',
        headers: { authorization: 'Bearer opaque-SSO-token', 'content-type': 'application/json' },
      }),
    ),
    400,
    'invalid_request',
  );
  assert.deepEqual(f.calls, ['authenticate']);
});
test('cancellation during a stalled body read cancels the stream without mutation', async () => {
  let resolveRead!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    resolveRead = resolve;
  });
  let cancelled = false;
  const controller = new AbortController();
  const f = fixture();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull() {
        resolveRead();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const req = new Request(`http://localhost${paths.issue}`, {
    method: 'POST',
    headers: { authorization: 'Bearer opaque-SSO-token', 'content-type': 'application/json' },
    body: stream,
    signal: controller.signal,
    duplex: 'half',
  } as RequestInit);
  const response = f.handler(req);
  await readStarted;
  controller.abort();
  await checkError(await response, 400, 'invalid_request');
  assert.equal(cancelled, true);
  assert.deepEqual(f.calls, ['authenticate']);
  assert.deepEqual(f.inputs, []);
});
test('trusted ports are read once and exact bounded Unicode IDs are preserved', async () => {
  const f = fixture();
  const captured: Record<string, number> = {};
  const ports = Object.fromEntries(
    Object.entries(f.ports).map(([key, value]) => [
      key,
      {
        get() {
          captured[key] = (captured[key] ?? 0) + 1;
          return value;
        },
        enumerable: true,
      },
    ]),
  );
  const source = Object.defineProperties({}, ports) as Ports;
  const handler = createSsoManagementHandler(source);
  const owner = '人'.repeat(256);
  assert.equal((await handler(request('issue', { principalId: owner, expiresAt: 0 }))).status, 201);
  assert.deepEqual(captured, Object.fromEntries(Object.keys(f.ports).map((key) => [key, 1])));
  assert.equal((f.inputs[0] as { principalId: string }).principalId, owner);
});

test('failed cancellation cleanup stays private and cannot dispatch management', async () => {
  let started!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const cancellation = new AbortController();
  const f = fixture();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull() {
        started();
      },
      cancel() {
        throw Error('private-cancellation');
      },
    },
    { highWaterMark: 0 },
  );
  const req = new Request(`http://localhost${paths.issue}`, {
    method: 'POST',
    headers: { authorization: 'Bearer opaque-SSO-token', 'content-type': 'application/json' },
    body: stream,
    signal: cancellation.signal,
    duplex: 'half',
  } as RequestInit);
  const response = f.handler(req);
  await readStarted;
  cancellation.abort();
  await checkError(await response, 400, 'invalid_request');
  assert.deepEqual(f.inputs, []);
});

test('injected Node adapter failures return no-store 503 without invoking authentication', async () => {
  const f = fixture();
  const server = createSsoManagementServer(f.ports);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await new Promise<Response>((resolve, reject) => {
      const req = nodeRequest(
        `http://127.0.0.1:${address.port}${paths.issue}`,
        { method: 'TRACE' },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (data) => {
            text += data;
          });
          res.on('end', () =>
            resolve(
              new Response(text, {
                status: res.statusCode ?? 500,
                headers: { 'cache-control': String(res.headers['cache-control']) },
              }),
            ),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
    await checkError(response, 503, 'internal_error', undefined);
    assert.deepEqual(f.calls, []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

for (const state of ['consumed', 'locked'] as const) {
  test(`authenticated ${state} Fetch body is invalid input, not a management outage`, async () => {
    const f = fixture();
    const req = request('issue');
    const reader = state === 'locked' ? req.body?.getReader() : undefined;
    if (state === 'consumed') await req.text();
    try {
      await checkError(await f.handler(req), 400, 'invalid_request');
      assert.deepEqual(f.calls, ['authenticate']);
      assert.deepEqual(f.inputs, []);
      assert.deepEqual(f.events, []);
    } finally {
      reader?.releaseLock();
    }
  });
}
