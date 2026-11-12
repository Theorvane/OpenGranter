import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSsoManagementHandler } from '../src/gateway/sso-management-http.ts';
import {
  InvalidTokenManagementLifetime,
  TokenManagementDenied,
} from '../src/gateway/token-management.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { issueManagementToken, validIssuance } from '../src/management/token-issue-client.ts';
import { mountTokenIssuancePanel } from '../src/management/token-issue-panel.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  attributes: Record<string, string> = {};
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.textContent = null;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  focus() {}
}
const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
const text = (root: Element) =>
  nodes(root)
    .map((n) => n.textContent ?? '')
    .join(' ');
function button(root: Element, label: string) {
  const found = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(found, label);
  return found;
}
function enter(root: Element, principal = 'principal', expiry = '2000000000000') {
  const inputs = nodes(root).filter((n) => n.tag === 'input');
  assert.equal(inputs.length, 2);
  const [principalInput, expiryInput] = inputs;
  assert.ok(principalInput);
  assert.ok(expiryInput);
  principalInput.value = principal;
  expiryInput.value = expiry;
  button(root, 'Review issuance').listeners.click?.();
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const issued = () =>
  Response.json({ credentialId: 'credential', token: 'synthetic-display-only' }, { status: 201 });

test('issuance client exact authorized-port payload and validated result', async () => {
  let calls = 0;
  const result = await issueManagementToken(
    async (path, init) => {
      calls++;
      assert.equal(path, '/management/v1/proxy-tokens');
      assert.equal(init.method, 'POST');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.redirect, 'error');
      assert.equal(init.credentials, undefined);
      assert.deepEqual(init.headers, {
        'content-type': 'application/json',
        accept: 'application/json',
      });
      assert.deepEqual(JSON.parse(String(init.body)), {
        principalId: 'principal',
        expiresAt: 2000000000000,
      });
      return issued();
    },
    'principal',
    2000000000000,
  );
  assert.equal(calls, 1);
  assert.equal(result.state, 'ready');
  if (result.state === 'ready') {
    assert.equal(result.credentialId, 'credential');
    assert.equal(result.token.length, 22);
  }
});

test('input validation matches opaque Unicode IDs and safe millisecond expiry, no invalid calls', async () => {
  for (const id of ['', '\0', '\ud800', 'a'.repeat(257)]) {
    assert.equal(validIssuance(id, 0), false);
    assert.equal(
      (
        await issueManagementToken(
          async () => {
            throw Error('must not call');
          },
          id,
          0,
        )
      ).state,
      'invalid_input',
    );
  }
  for (const expiry of [-1, NaN, Infinity, 0.2, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(validIssuance('p', expiry), false);
  assert.equal(validIssuance('유니코드😀', 0), true);
});

test('safe status mapping never returns raw errors or retries', async () => {
  for (const [status, state] of [
    [400, 'invalid_input'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [409, 'uncertain'],
    [500, 'uncertain'],
  ] as const) {
    let calls = 0;
    assert.deepEqual(
      await issueManagementToken(
        async () => {
          calls++;
          return new Response('private-body', { status });
        },
        'p',
        1,
      ),
      { state },
    );
    assert.equal(calls, 1);
  }
  assert.deepEqual(
    await issueManagementToken(
      async () => {
        throw Error('private exception');
      },
      'p',
      1,
    ),
    { state: 'uncertain' },
  );
});

test('reject malformed, extra, wrong-status, unsafe and oversized issuance envelopes', async () => {
  const invalid = [
    [],
    {},
    { credentialId: 'c', token: '' },
    { credentialId: 'c', token: 'x', extra: 'private' },
    { credentialId: 'c', token: '\ud800' },
    { credentialId: 'c', token: 'x'.repeat(16385) },
  ];
  for (const value of invalid)
    assert.deepEqual(
      await issueManagementToken(async () => Response.json(value, { status: 201 }), 'p', 1),
      { state: 'uncertain' },
    );
  for (const response of [
    Response.json({ credentialId: 'c', token: 't' }),
    new Response('{', { status: 201, headers: { 'content-type': 'application/json' } }),
    new Response('x', { status: 201 }),
    new Response(new Uint8Array([255]), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }),
    new Response(' '.repeat(131073), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }),
  ]) {
    assert.deepEqual(await issueManagementToken(async () => response, 'p', 1), {
      state: 'uncertain',
    });
  }
});

test('pre-abort avoids issue; abort during response clears result and cancels stream', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(
    await issueManagementToken(
      async () => {
        throw Error('not called');
      },
      'p',
      1,
      controller.signal,
    ),
    { state: 'cancelled' },
  );
  const active = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = issueManagementToken(
    async () =>
      new Response(stream, { status: 201, headers: { 'content-type': 'application/json' } }),
    'p',
    1,
    active.signal,
  );
  await tick();
  active.abort();
  assert.deepEqual(await result, { state: 'cancelled' });
  assert.equal(cancelled, true);
});

test('panel explicit review/cancel/confirm prevents stale duplicate issuance; clear removes secret', async () => {
  const root = new Element();
  let calls = 0;
  let finish!: (response: Response) => void;
  const panel = mountTokenIssuancePanel(root, async () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  enter(root, '<b>principal</b>');
  const cancelledConfirm = button(root, 'Confirm issuance');
  assert.equal(calls, 0);
  assert.match(text(root), /<b>principal<\/b>/);
  button(root, 'Cancel').listeners.click?.();
  cancelledConfirm.listeners.click?.();
  assert.equal(calls, 0);
  enter(root);
  const confirm = button(root, 'Confirm issuance');
  confirm.listeners.click?.();
  confirm.listeners.click?.();
  assert.equal(calls, 1);
  assert.match(text(root), /progress/);
  finish(issued());
  await tick();
  assert.match(text(root), /synthetic-display-only/);
  const clear = button(root, 'Clear issued token');
  clear.listeners.click?.();
  assert.doesNotMatch(text(root), /synthetic-display-only/);
  confirm.listeners.click?.();
  clear.listeners.click?.();
  assert.equal(calls, 1);
  panel.dispose();
  assert.equal(text(root).trim(), '');
});

test('panel invalid numeric input never issues, and result strings use textContent only', async () => {
  const root = new Element();
  let calls = 0;
  mountTokenIssuancePanel(root, async () => {
    calls++;
    return Response.json(
      { credentialId: '<b>ID</b>', token: '<script>synthetic</script>' },
      { status: 201 },
    );
  });
  for (const expiry of ['', '-1', '1.2', '1e3', ' 1', '9007199254740992']) {
    enter(root, 'p', expiry);
    assert.match(text(root), /valid/);
  }
  assert.equal(calls, 0);
  enter(root);
  button(root, 'Confirm issuance').listeners.click?.();
  await tick();
  assert.match(text(root), /<script>synthetic<\/script>/);
  assert.equal(
    nodes(root).some((n) => n.tag === 'script'),
    false,
  );
});

test('fresh denial locks panel, uncertainty does not claim rollback or repeat', async () => {
  for (const status of [401, 403, 503]) {
    const root = new Element();
    let calls = 0;
    mountTokenIssuancePanel(root, async () => {
      calls++;
      return new Response('private-body', { status });
    });
    enter(root);
    button(root, 'Confirm issuance').listeners.click?.();
    await tick();
    assert.doesNotMatch(text(root), /private-body|synthetic/);
    if (status === 503) assert.match(text(root), /may have/);
    else assert.equal(nodes(root).filter((n) => n.tag === 'input').length, 0);
    assert.equal(calls, 1);
  }
});

test('dispose aborts pending issue, suppresses late results and stale input callbacks', async () => {
  const root = new Element();
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const panel = mountTokenIssuancePanel(root, async (_path, init) => {
    signal = init.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  enter(root);
  button(root, 'Confirm issuance').listeners.click?.();
  panel.dispose();
  assert.equal(signal?.aborted, true);
  finish(issued());
  await tick();
  assert.equal(text(root).trim(), '');
});

test('client through SSO public handler preserves trusted actor and lifetime denial', async () => {
  let mode = 'ok';
  let calls = 0;
  const handler = createSsoManagementHandler({
    newRequestId: () => 'request',
    authenticate: async () => 'actor',
    writeAudit: async () => {},
    revoke: async () => false,
    issue: async (input) => {
      calls++;
      assert.deepEqual(input, {
        authenticatedActorId: 'actor',
        requestId: 'request',
        principalId: 'p',
        expiresAt: 1,
      });
      if (mode === 'denied') throw new TokenManagementDenied();
      if (mode === 'lifetime') throw new InvalidTokenManagementLifetime();
      if (mode === 'audit') throw Error('private');
      return { credentialId: 'credential', token: 'synthetic-display-only' };
    },
  });
  const port = async (path: string, init: RequestInit) =>
    handler(
      new Request(`https://unit.invalid${path}`, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer synthetic-auth-only' },
      }),
    );
  for (const [next, state] of [
    ['ok', 'ready'],
    ['denied', 'denied'],
    ['lifetime', 'invalid_input'],
    ['audit', 'uncertain'],
  ]) {
    assert.ok(next);
    mode = next;
    assert.equal((await issueManagementToken(port, 'p', 1)).state, state);
  }
  assert.equal(calls, 4);
});

test('clear and disposal wipe even detached owned credential nodes without redisplay', async () => {
  for (const action of ['clear', 'dispose']) {
    const root = new Element();
    const panel = mountTokenIssuancePanel(root, async () => issued());
    enter(root);
    button(root, 'Confirm issuance').listeners.click?.();
    await tick();
    const owned = nodes(root).filter((n) => n.tag === 'pre');
    assert.equal(owned.length, 2);
    assert.ok(owned.every((n) => !!n.textContent));
    const clear = button(root, 'Clear issued token');
    if (action === 'clear') clear.listeners.click?.();
    else panel.dispose();
    assert.ok(owned.every((n) => n.textContent === ''));
    clear.listeners.click?.();
    assert.doesNotMatch(text(root), /synthetic-display-only/);
  }
});

test('client accepts maximum server-compatible escaped Unicode secret without truncation', async () => {
  const result = await issueManagementToken(
    async () =>
      Response.json(
        { credentialId: '😀'.repeat(128), token: '\u0001'.repeat(16384) },
        { status: 201 },
      ),
    'p',
    0,
  );
  assert.equal(result.state, 'ready');
  if (result.state === 'ready') assert.equal(result.token.length, 16384);
});
