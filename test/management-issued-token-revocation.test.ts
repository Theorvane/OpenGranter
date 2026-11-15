import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createSsoManagementServer } from '../src/gateway/sso-management-http.ts';
import { TokenManagementDenied } from '../src/gateway/token-management.ts';
import { SsoManagementUnauthenticated } from '../src/identity/postgres-sso-human-authentication.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountTokenManagementPanel } from '../src/management/token-management-panel.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  attributes: Record<string, string> = {};
  focused = false;
  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
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
  focus() {
    this.focused = true;
  }
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
  assert.ok(input);
  input.value = value;
}
const handoff = 'Review revocation of issued token';
const id = 'issued/+@雪';
function success(path: string) {
  return path.endsWith('/revoke')
    ? Response.json({ revoked: true })
    : Response.json({ credentialId: id, token: 'synthetic-panel-value' }, { status: 201 });
}
async function issue(root: Element) {
  enter(root, 'Principal ID', 'person');
  enter(root, 'Expiry (Unix milliseconds, integer)', '2000');
  click(root, 'Review issuance');
  click(root, 'Confirm issuance');
  await tick();
}
function reviewRevoke(root: Element) {
  enter(root, 'Credential ID', 'older-credential');
  click(root, 'Review revocation');
}
test('handoff clears detached secret nodes, passes exact ID and requires separate confirmation', async () => {
  const root = new Element();
  const calls: string[] = [];
  const panel = mountTokenManagementPanel(root, async (path, init) => {
    calls.push(path);
    if (path.endsWith('/revoke'))
      assert.deepEqual(JSON.parse(String(init.body)), { credentialId: id });
    return success(path);
  });
  await issue(root);
  const owned = nodes(root).filter((n) => n.tag === 'pre');
  assert.equal(owned.length, 2);
  const action = click(root, handoff);
  assert.equal(calls.length, 1);
  assert.ok(owned.every((n) => n.textContent === ''));
  assert.ok(text(root).includes('Confirm revocation for credential ID: ' + id));
  assert.doesNotMatch(text(root), /synthetic-panel-value/);
  action.listeners.click?.();
  const confirm = click(root, 'Confirm revocation');
  confirm.listeners.click?.();
  await tick();
  assert.equal(calls.length, 2);
  assert.match(text(root), /Token revocation confirmed/);
  panel.dispose();
});
test('handoff replaces unsubmitted review; cancel and stale confirmation never revoke', async () => {
  const root = new Element();
  let calls = 0;
  mountTokenManagementPanel(root, async (path) => {
    calls++;
    return success(path);
  });
  reviewRevoke(root);
  const old = nodes(root).find((n) => n.textContent === 'Confirm revocation');
  assert.ok(old);
  await issue(root);
  click(root, handoff);
  old.listeners.click?.();
  click(root, 'Cancel');
  assert.equal(calls, 1);
  assert.match(text(root), /Display cleared/);
  assert.doesNotMatch(text(root), /synthetic-panel-value/);
});
test('pending revocation cannot be replaced; handoff can retry after completion', async () => {
  const root = new Element();
  let release!: (r: Response) => void;
  let calls = 0;
  mountTokenManagementPanel(root, async (path) => {
    calls++;
    return path.endsWith('/revoke')
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : success(path);
  });
  await issue(root);
  reviewRevoke(root);
  click(root, 'Confirm revocation');
  const action = click(root, handoff);
  assert.equal(calls, 2);
  assert.match(text(root), /Revocation already in progress/);
  assert.match(text(root), /synthetic-panel-value/);
  release(Response.json({ revoked: true }));
  await tick();
  action.listeners.click?.();
  assert.doesNotMatch(text(root), /synthetic-panel-value/);
  assert.ok(text(root).includes('Confirm revocation for credential ID: ' + id));
  assert.equal(calls, 2);
});
test('retained handoff cannot operate after clear or disposal', async () => {
  for (const mode of ['clear', 'dispose']) {
    const root = new Element();
    let calls = 0;
    const panel = mountTokenManagementPanel(root, async (path) => {
      calls++;
      return success(path);
    });
    await issue(root);
    const action = nodes(root).find((n) => n.textContent === handoff);
    assert.ok(action);
    if (mode === 'clear') click(root, 'Clear issued token');
    else panel.dispose();
    const before = text(root);
    action.listeners.click?.();
    assert.equal(text(root), before);
    assert.equal(calls, 1);
  }
});
for (const outcome of ['success', 'denied', 'unauthenticated', 'unavailable'] as const) {
  test('handoff through actual loopback SSO HTTP: ' + outcome, async () => {
    const root = new Element();
    let auth = 0;
    let revokes = 0;
    const server = createSsoManagementServer({
      newRequestId: () => 'request',
      authenticate: async (token) => {
        assert.equal(token, 'synthetic-access');
        auth++;
        if (auth === 2 && outcome === 'unauthenticated') throw new SsoManagementUnauthenticated();
        return 'actor';
      },
      issue: async () => ({ credentialId: id, token: 'synthetic-panel-value' }),
      revoke: async (input) => {
        revokes++;
        assert.equal(input.credentialId, id);
        assert.equal(input.authenticatedActorId, 'actor');
        if (outcome === 'denied') throw new TokenManagementDenied();
        if (outcome === 'unavailable') throw Error('private-diagnostics');
        return true;
      },
      writeAudit: async () => {},
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const panel = mountTokenManagementPanel(root, (path, init) =>
      fetch('http://127.0.0.1:' + address.port + path, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer synthetic-access' },
      }),
    );
    const waitFor = async (pattern: RegExp) => {
      for (let i = 0; i < 100 && !pattern.test(text(root)); i++)
        await new Promise((r) => setTimeout(r, 10));
      assert.match(text(root), pattern);
    };
    try {
      await issue(root);
      await waitFor(/synthetic-panel-value/);
      click(root, handoff);
      assert.equal(auth, 1);
      assert.doesNotMatch(text(root), /synthetic-panel-value/);
      click(root, 'Confirm revocation');
      await waitFor(
        outcome === 'success'
          ? /Token revocation confirmed/
          : outcome === 'denied'
            ? /Access denied/
            : outcome === 'unauthenticated'
              ? /Sign-in required/
              : /outcome is unknown/,
      );
      assert.equal(auth, 2);
      assert.equal(revokes, outcome === 'unauthenticated' ? 0 : 1);
      assert.doesNotMatch(text(root), /private-diagnostics|synthetic-access|synthetic-panel-value/);
    } finally {
      panel.dispose();
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    }
  });
}

test('handoff keeps the revocation landmark and focuses explicit confirmation', async () => {
  const root = new Element();
  mountTokenManagementPanel(root, async (path) => success(path));
  await issue(root);
  click(root, handoff);
  const region = nodes(root).find(
    (n) => n.tag === 'section' && n.attributes['aria-label'] === 'Proxy-token revocation',
  );
  assert.ok(region, 'labelled revocation region remains available during review');
  assert.match(text(region), /Confirm revocation for credential ID:/);
  const confirm = nodes(region).find((n) => n.textContent === 'Confirm revocation');
  assert.equal(confirm?.focused, true);
});
