import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import {
  createSsoManagementHandler,
  createSsoManagementServer,
} from '../src/gateway/sso-management-http.ts';
import { TokenManagementDenied } from '../src/gateway/token-management.ts';
import { SsoManagementUnauthenticated } from '../src/identity/postgres-sso-human-authentication.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountTokenManagementPanel } from '../src/management/token-management-panel.ts';

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
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}
function enter(root: Element, label: string, value: string) {
  const input = nodes(root).find((n) => n.tag === 'label' && n.textContent === label)?.children[0];
  assert.ok(input, label);
  input.value = value;
}
function reviewIssue(root: Element) {
  enter(root, 'Principal ID', 'person');
  enter(root, 'Expiry (Unix milliseconds, integer)', '2000');
  click(root, 'Review issuance');
}
function reviewRevoke(root: Element) {
  enter(root, 'Credential ID', 'credential');
  click(root, 'Review revocation');
}
function success(path: string) {
  return path.endsWith('/revoke')
    ? Response.json({ revoked: true })
    : Response.json(
        { credentialId: 'credential', token: 'synthetic-panel-value' },
        { status: 201 },
      );
}

test('mount/review/cancel send nothing; exact explicit mutations preserve both panels', async () => {
  const root = new Element();
  const calls: string[] = [];
  const panel = mountTokenManagementPanel(root, async (path, init) => {
    calls.push(path);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.method, 'POST');
    assert.deepEqual(
      JSON.parse(String(init.body)),
      path.endsWith('/revoke')
        ? { credentialId: 'credential' }
        : { principalId: 'person', expiresAt: 2000 },
    );
    return success(path);
  });
  reviewIssue(root);
  click(root, 'Cancel');
  reviewRevoke(root);
  click(root, 'Cancel');
  assert.equal(calls.length, 0);
  reviewIssue(root);
  const confirm = click(root, 'Confirm issuance');
  confirm.listeners.click?.();
  await tick();
  assert.match(text(root), /synthetic-panel-value/);
  reviewRevoke(root);
  click(root, 'Confirm revocation');
  await tick();
  assert.deepEqual(calls, ['/management/v1/proxy-tokens', '/management/v1/proxy-tokens/revoke']);
  assert.match(text(root), /Token revocation confirmed/);
  panel.dispose();
  assert.equal(text(root), '');
});

for (const status of [401, 403]) {
  test(`revocation ${status} wipes displayed and detached sibling credentials and locks both`, async () => {
    const root = new Element();
    let calls = 0;
    mountTokenManagementPanel(root, async (path) => {
      calls++;
      return path.endsWith('/revoke') ? new Response('private-error', { status }) : success(path);
    });
    reviewRevoke(root);
    const revokeConfirm = nodes(root).find((n) => n.textContent === 'Confirm revocation');
    assert.ok(revokeConfirm);
    reviewIssue(root);
    click(root, 'Confirm issuance');
    await tick();
    const secret = nodes(root).find((n) => n.textContent === 'synthetic-panel-value');
    assert.ok(secret);
    click(root, 'Confirm revocation');
    await tick();
    assert.equal(secret.textContent, '');
    assert.doesNotMatch(
      text(root),
      /synthetic-panel-value|private-error|Review issuance|Review revocation/,
    );
    assert.match(text(root), status === 401 ? /Sign-in required/ : /Access denied/);
    revokeConfirm.listeners.click?.();
    await tick();
    assert.equal(calls, 2);
  });
  test(`issuance ${status} aborts pending revocation and ignores late success`, async () => {
    const root = new Element();
    let signal: AbortSignal | null | undefined;
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    mountTokenManagementPanel(root, async (path, init) => {
      if (path.endsWith('/revoke')) {
        signal = init.signal;
        return pending;
      }
      return new Response('private', { status });
    });
    reviewRevoke(root);
    click(root, 'Confirm revocation');
    reviewIssue(root);
    click(root, 'Confirm issuance');
    await tick();
    assert.equal(signal?.aborted, true);
    const boundary = text(root);
    assert.match(boundary, status === 401 ? /Sign-in required/ : /Access denied/);
    release(Response.json({ revoked: true }));
    await tick();
    assert.equal(text(root), boundary);
  });
}

test('revocation denial aborts pending issuance and suppresses late secret', async () => {
  const root = new Element();
  let signal: AbortSignal | null | undefined;
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  mountTokenManagementPanel(root, async (path, init) => {
    if (!path.endsWith('/revoke')) {
      signal = init.signal;
      return pending;
    }
    return new Response(null, { status: 403 });
  });
  reviewIssue(root);
  click(root, 'Confirm issuance');
  reviewRevoke(root);
  click(root, 'Confirm revocation');
  await tick();
  assert.equal(signal?.aborted, true);
  release(success('/management/v1/proxy-tokens'));
  await tick();
  assert.match(text(root), /Access denied/);
  assert.doesNotMatch(text(root), /synthetic-panel-value/);
});

test('dispose aborts both pending mutations; late rejection and stale clicks remain silent', async () => {
  const root = new Element();
  const signals: (AbortSignal | null | undefined)[] = [];
  const rejects: ((reason: Error) => void)[] = [];
  let calls = 0;
  const panel = mountTokenManagementPanel(root, async (_path, init) => {
    calls++;
    signals.push(init.signal);
    return new Promise<Response>((_resolve, reject) => {
      rejects.push(reject);
    });
  });
  reviewIssue(root);
  const staleIssue = click(root, 'Confirm issuance');
  reviewRevoke(root);
  const staleRevoke = click(root, 'Confirm revocation');
  panel.dispose();
  panel.dispose();
  assert.equal(text(root), '');
  assert.equal(signals.length, 2);
  assert.ok(signals.every((s) => s?.aborted));
  for (const reject of rejects) reject(Error('private'));
  await tick();
  staleIssue.listeners.click?.();
  staleRevoke.listeners.click?.();
  await tick();
  assert.equal(text(root), '');
  assert.equal(calls, 2);
});

test('transport uncertainty is not global denial; a separate mount is isolated', async () => {
  const a = new Element();
  const b = new Element();
  let calls = 0;
  const port: CatalogRequest = async () => {
    calls++;
    throw Error('private');
  };
  const first = mountTokenManagementPanel(a, port);
  const second = mountTokenManagementPanel(b, async (path) => success(path));
  reviewIssue(a);
  click(a, 'Confirm issuance');
  await tick();
  assert.match(text(a), /outcome is unknown/);
  assert.doesNotMatch(text(a), /private/);
  reviewRevoke(a);
  click(a, 'Confirm revocation');
  await tick();
  assert.equal(calls, 2);
  first.dispose();
  reviewIssue(b);
  click(b, 'Confirm issuance');
  await tick();
  assert.match(text(b), /synthetic-panel-value/);
  second.dispose();
  assert.equal(text(b), '');
});

for (const outcome of ['success', 'denied', 'unauthenticated', 'unavailable'] as const) {
  test(`composed panel crosses actual SSO Fetch boundary: ${outcome}`, async () => {
    const root = new Element();
    let authenticateCalls = 0;
    let issueCalls = 0;
    let revokeCalls = 0;
    const handler = createSsoManagementHandler({
      newRequestId: () => 'request',
      authenticate: async (token) => {
        assert.equal(token, 'synthetic-access');
        authenticateCalls++;
        if (authenticateCalls === 2 && outcome === 'unauthenticated')
          throw new SsoManagementUnauthenticated();
        return 'human';
      },
      issue: async (input) => {
        issueCalls++;
        assert.deepEqual(input, {
          authenticatedActorId: 'human',
          requestId: 'request',
          principalId: 'person',
          expiresAt: 2000,
        });
        return { credentialId: 'credential', token: 'synthetic-panel-value' };
      },
      revoke: async (input) => {
        revokeCalls++;
        assert.deepEqual(input, {
          authenticatedActorId: 'human',
          requestId: 'request',
          credentialId: 'credential',
        });
        if (outcome === 'denied') throw new TokenManagementDenied();
        if (outcome === 'unavailable') throw Error('private-audit-failure');
        return true;
      },
      writeAudit: async () => {},
    });
    const panel = mountTokenManagementPanel(root, (path, init) =>
      handler(
        new Request(`https://local.invalid${path}`, {
          ...init,
          headers: { ...init.headers, authorization: 'Bearer synthetic-access' },
        }),
      ),
    );
    reviewIssue(root);
    click(root, 'Confirm issuance');
    await tick();
    const secret = nodes(root).find((n) => n.textContent === 'synthetic-panel-value');
    assert.ok(secret);
    reviewRevoke(root);
    click(root, 'Confirm revocation');
    await tick();
    assert.equal(authenticateCalls, 2);
    assert.equal(issueCalls, 1);
    assert.equal(revokeCalls, outcome === 'unauthenticated' ? 0 : 1);
    if (outcome === 'denied' || outcome === 'unauthenticated') {
      assert.equal(secret.textContent, '');
      assert.match(text(root), outcome === 'denied' ? /Access denied/ : /Sign-in required/);
    } else {
      assert.match(
        text(root),
        outcome === 'success' ? /Token revocation confirmed/ : /outcome is unknown/,
      );
    }
    assert.doesNotMatch(text(root), /private-audit-failure|synthetic-access/);
    panel.dispose();
    assert.equal(secret.textContent, '');
  });
}

for (const firstStatus of [401, 403]) {
  test(`first terminal status wins over aborted sibling denial: ${firstStatus}`, async () => {
    const root = new Element();
    const pending: ((r: Response) => void)[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    const panel = mountTokenManagementPanel(root, async (_path, init) => {
      signals.push(init.signal);
      return new Promise<Response>((resolve) => {
        pending.push(resolve);
      });
    });
    reviewIssue(root);
    const issue = click(root, 'Confirm issuance');
    issue.listeners.click?.();
    reviewRevoke(root);
    const revoke = click(root, 'Confirm revocation');
    revoke.listeners.click?.();
    assert.equal(pending.length, 2);
    const first = pending[0];
    const second = pending[1];
    assert.ok(first);
    assert.ok(second);
    first(new Response(null, { status: firstStatus }));
    await tick();
    assert.ok(signals.every((s) => s?.aborted));
    const boundary = text(root);
    assert.match(boundary, firstStatus === 401 ? /Sign-in required/ : /Access denied/);
    second(new Response(null, { status: firstStatus === 401 ? 403 : 401 }));
    await tick();
    assert.equal(text(root), boundary);
    issue.listeners.click?.();
    revoke.listeners.click?.();
    assert.equal(pending.length, 2);
    panel.dispose();
    assert.equal(text(root), '');
  });
}

test('shared panel crosses a real loopback Node HTTP socket and clears issuance on denied revoke', async () => {
  const root = new Element();
  const mutations: string[] = [];
  const server = createSsoManagementServer({
    newRequestId: () => 'socket-request',
    authenticate: async (token) => {
      assert.equal(token, 'synthetic-socket-access');
      return 'socket-human';
    },
    issue: async (input) => {
      assert.equal(input.authenticatedActorId, 'socket-human');
      assert.equal(input.principalId, 'person');
      assert.equal(input.expiresAt, 2000);
      mutations.push('issue');
      return { credentialId: 'credential', token: 'synthetic-socket-secret' };
    },
    revoke: async (input) => {
      assert.equal(input.authenticatedActorId, 'socket-human');
      assert.equal(input.credentialId, 'credential');
      mutations.push('revoke');
      throw new TokenManagementDenied();
    },
    writeAudit: async () => {},
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const responses: number[] = [];
  const panel = mountTokenManagementPanel(root, async (path, init) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: 'Bearer synthetic-socket-access' },
    });
    responses.push(response.status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response;
  });
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'loopback UI did not settle');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  try {
    reviewIssue(root);
    assert.deepEqual(mutations, []);
    click(root, 'Confirm issuance');
    await waitFor(() => text(root).includes('synthetic-socket-secret'));
    const secret = nodes(root).find((node) => node.textContent === 'synthetic-socket-secret');
    assert.ok(secret);
    reviewRevoke(root);
    const stale = click(root, 'Confirm revocation');
    await waitFor(() => text(root).includes('Access denied'));
    assert.equal(secret.textContent, '');
    assert.deepEqual(responses, [201, 403]);
    assert.deepEqual(mutations, ['issue', 'revoke']);
    stale.listeners.click?.();
    await tick();
    assert.deepEqual(mutations, ['issue', 'revoke']);
    assert.doesNotMatch(text(root), /synthetic-socket/);
  } finally {
    panel.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
