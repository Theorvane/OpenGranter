import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSsoManagementHandler } from '../src/gateway/sso-management-http.ts';
import { TokenManagementDenied } from '../src/gateway/token-management.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { revokeManagementToken } from '../src/management/token-revoke-client.ts';
import { mountTokenRevocationPanel } from '../src/management/token-revoke-panel.ts';

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
function enter(root: Element, id = 'credential') {
  const input = nodes(root).find((n) => n.tag === 'input');
  assert.ok(input);
  input.value = id;
  button(root, 'Review revocation').listeners.click?.();
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('client sends only exact confirmed mutation and preserves true/false', async () => {
  for (const revoked of [true, false]) {
    let calls = 0;
    assert.deepEqual(
      await revokeManagementToken(async (path, init) => {
        calls++;
        assert.equal(path, '/management/v1/proxy-tokens/revoke');
        assert.equal(init.method, 'POST');
        assert.equal(init.cache, 'no-store');
        assert.equal(init.redirect, 'error');
        assert.equal(init.credentials, undefined);
        assert.deepEqual(init.headers, {
          'content-type': 'application/json',
          accept: 'application/json',
        });
        assert.equal(init.body, JSON.stringify({ credentialId: 'opaque/ID? 😀' }));
        return Response.json({ revoked });
      }, 'opaque/ID? 😀'),
      { state: 'ready', revoked },
    );
    assert.equal(calls, 1);
  }
});

test('invalid IDs and pre-aborted calls never reach request port', async () => {
  let calls = 0;
  const port = async () => {
    calls++;
    throw Error('private');
  };
  for (const id of ['', 'a'.repeat(257), '\0', '\ud800', '\udfff']) {
    assert.deepEqual(await revokeManagementToken(port, id), { state: 'invalid_input' });
  }
  assert.deepEqual(await revokeManagementToken(port, 'ok', AbortSignal.abort()), {
    state: 'cancelled',
  });
  assert.equal(calls, 0);
});

test('private errors and malformed success never become success or leaked text', async () => {
  const cases: [Response, string][] = [
    [new Response('private', { status: 401 }), 'unauthenticated'],
    [new Response('private', { status: 403 }), 'denied'],
    [new Response('private', { status: 503 }), 'uncertain'],
    [Response.json({ revoked: true }, { status: 201 }), 'uncertain'],
    [Response.json({ revoked: true, token: 'private' }), 'uncertain'],
    [Response.json({ revoked: 'true' }), 'uncertain'],
    [Response.json(null), 'uncertain'],
    [new Response('{"revoked":true}'), 'uncertain'],
    [
      new Response(`${' '.repeat(4097)}{"revoked":true}`, {
        headers: { 'content-type': 'application/json' },
      }),
      'uncertain',
    ],
    [
      new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
      'uncertain',
    ],
  ];
  for (const [response, state] of cases)
    assert.deepEqual(await revokeManagementToken(async () => response, 'id'), { state });
  assert.deepEqual(
    await revokeManagementToken(async () => {
      throw Error('private');
    }, 'id'),
    { state: 'uncertain' },
  );
});

test('panel requires confirmation, literal ID text, cancels stale confirmation', async () => {
  const root = new Element();
  let calls = 0;
  const panel = mountTokenRevocationPanel(root, async () => {
    calls++;
    return Response.json({ revoked: true });
  });
  assert.equal(calls, 0);
  enter(root, '<img src=x>');
  assert.match(text(root), /<img src=x>/);
  assert.equal(
    nodes(root).some((n) => n.tag === 'img'),
    false,
  );
  const stale = button(root, 'Confirm revocation');
  assert.equal(calls, 0);
  button(root, 'Cancel').listeners.click?.();
  stale.listeners.click?.();
  assert.equal(calls, 0);
  enter(root);
  button(root, 'Confirm revocation').listeners.click?.();
  await tick();
  assert.equal(calls, 1);
  assert.match(text(root), /Token revocation confirmed/);
  panel.dispose();
  assert.equal(root.children.length, 0);
});

test('overlap and disposed late mutation cannot replay or resurrect DOM', async () => {
  const root = new Element();
  let finish!: (r: Response) => void;
  let calls = 0;
  let signal: AbortSignal | undefined | null;
  const panel = mountTokenRevocationPanel(root, async (_path, init) => {
    calls++;
    signal = init.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  enter(root);
  const confirm = button(root, 'Confirm revocation');
  confirm.listeners.click?.();
  confirm.listeners.click?.();
  assert.equal(calls, 1);
  assert.match(text(root), /in progress/);
  panel.dispose();
  assert.equal(signal?.aborted, true);
  finish(Response.json({ revoked: true }));
  await tick();
  confirm.listeners.click?.();
  assert.equal(calls, 1);
  assert.equal(root.children.length, 0);
});

for (const status of [401, 403, 503])
  test(`panel safe failure ${status}`, async () => {
    const root = new Element();
    let calls = 0;
    mountTokenRevocationPanel(root, async () => {
      calls++;
      return new Response('private-token', { status });
    });
    enter(root);
    const old = button(root, 'Confirm revocation');
    old.listeners.click?.();
    await tick();
    assert.equal(calls, 1);
    assert.ok(!text(root).includes('private-token'));
    old.listeners.click?.();
    assert.equal(calls, 1);
    assert.equal(nodes(root).filter((n) => n.tag === 'input').length, status === 503 ? 1 : 0);
    if (status === 503) assert.match(text(root), /unknown.*may have completed/);
  });

test('existing SSO handler still authenticates then invokes revocation and hides Deny/audit failures', async () => {
  for (const outcome of ['success', 'deny', 'audit'] as const) {
    const calls: string[] = [];
    const handler = createSsoManagementHandler({
      newRequestId: () => 'request-1',
      authenticate: async (token) => {
        assert.equal(token, 'fixture-access');
        calls.push('authenticate');
        return 'human';
      },
      issue: async () => {
        throw Error('must not issue');
      },
      revoke: async (input) => {
        calls.push('revoke');
        assert.deepEqual(input, {
          authenticatedActorId: 'human',
          requestId: 'request-1',
          credentialId: 'target',
        });
        if (outcome === 'deny') throw new TokenManagementDenied();
        if (outcome === 'audit') throw Error('private-audit-failure');
        return true;
      },
      writeAudit: async () => {},
    });
    const result = await revokeManagementToken(
      (path, init) =>
        handler(
          new Request(`https://local.invalid${path}`, {
            ...init,
            headers: { ...init.headers, authorization: 'Bearer fixture-access' },
          }),
        ),
      'target',
    );
    assert.deepEqual(
      result,
      outcome === 'success'
        ? { state: 'ready', revoked: true }
        : { state: outcome === 'deny' ? 'denied' : 'uncertain' },
    );
    assert.deepEqual(calls, ['authenticate', 'revoke']);
  }
});

test('false outcome is not reported as success and invalid panel input never posts', async () => {
  const root = new Element();
  let calls = 0;
  mountTokenRevocationPanel(root, async () => {
    calls++;
    return Response.json({ revoked: false });
  });
  enter(root, '');
  assert.equal(calls, 0);
  assert.match(text(root), /valid credential ID/);
  enter(root);
  button(root, 'Confirm revocation').listeners.click?.();
  await tick();
  assert.equal(calls, 1);
  assert.match(text(root), /No token revocation reported/);
  assert.ok(!text(root).includes('revocation confirmed'));
});

test('aborting a pending response read cancels stream but never reports rollback', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"revoked":'));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
  const operation = revokeManagementToken(async () => response, 'credential', controller.signal);
  await tick();
  controller.abort();
  assert.deepEqual(await operation, { state: 'cancelled' });
  assert.equal(cancelled, true);
});
