import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoModelCatalogServer } from '../src/gateway/postgres-sso-model-catalog-http.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountManagementOperations } from '../src/management/operations-app.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

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
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function adapter() {
  return {
    disposed: 0,
    save() {
      return 'started' as const;
    },
    dispose() {
      this.disposed++;
    },
  };
}
const model = { id: 'team/model', object: 'model', created: 0, owned_by: 'opengranter' };
const catalog = () => Response.json({ object: 'list', data: [model] });
test('Models connects fresh SSO list, detail and back without granting new authority', async () => {
  const root = new Element();
  const calls: string[] = [];
  const download = adapter();
  const app = mountManagementOperations(
    root,
    async (path, init) => {
      calls.push(path);
      assert.equal(init.method, 'GET');
      assert.equal(init.cache, 'no-store');
      if (path === '/management/v1/models') return catalog();
      if (path === '/management/v1/models/team%2Fmodel') return Response.json(model);
      return empty();
    },
    () => download,
  );
  await tick();
  click(root, 'Models');
  assert.match(text(root), /Loading models/);
  assert.equal(download.disposed, 1);
  await tick();
  assert.match(text(root), /team\/model/);
  click(root, 'team/model');
  await tick();
  assert.match(text(root), /team\/model/);
  click(root, 'Back to models');
  await tick();
  assert.deepEqual(calls.slice(1), [
    '/management/v1/models',
    '/management/v1/models/team%2Fmodel',
    '/management/v1/models',
  ]);
  const retained = nodes(root).find((n) => n.textContent === 'team/model');
  assert.ok(retained);
  click(root, 'Proxy tokens');
  retained.listeners.click?.();
  await tick();
  assert.equal(calls.length, 4);
  assert.match(text(root), /Issue proxy token/);
  click(root, 'Models');
  await tick();
  assert.equal(calls.length, 5);
  app.dispose();
  retained.listeners.click?.();
  assert.equal(root.children.length, 0);
});
test('Models exposes empty and generic failure recovery without private diagnostics', async () => {
  const root = new Element();
  let mode = 'error';
  const app = mountManagementOperations(
    root,
    async (path) => {
      if (path !== '/management/v1/models') return empty();
      if (mode === 'error') throw new Error('PRIVATE');
      if (mode === 'empty') return Response.json({ object: 'list', data: [] });
      return catalog();
    },
    adapter,
  );
  await tick();
  click(root, 'Models');
  await tick();
  assert.match(text(root), /catalog unavailable/);
  assert.doesNotMatch(text(root), /PRIVATE/);
  mode = 'empty';
  click(root, 'Back to models');
  await tick();
  assert.match(text(root), /No models available/);
  mode = 'ready';
  click(root, 'History');
  await tick();
  click(root, 'Models');
  await tick();
  click(root, 'team/model');
  await tick();
  assert.match(text(root), /catalog unavailable/);
  app.dispose();
});
for (const status of [401, 403]) {
  for (const detail of [false, true]) {
    test(`current catalog ${detail ? 'detail' : 'list'} ${status} clears navigation`, async () => {
      const root = new Element();
      let calls = 0;
      const app = mountManagementOperations(
        root,
        async (path) => {
          calls++;
          if (!path.startsWith('/management/v1/models')) return empty();
          return detail && path === '/management/v1/models'
            ? catalog()
            : new Response(null, { status });
        },
        adapter,
      );
      await tick();
      const retained = nodes(root).filter((n) => n.tag === 'button');
      click(root, 'Models');
      await tick();
      if (detail) {
        click(root, 'team/model');
        await tick();
      }
      assert.match(text(root), status === 401 ? /Sign-in required/ : /Access denied/);
      const before = calls;
      for (const node of retained) node.listeners.click?.();
      await tick();
      assert.equal(calls, before);
      assert.equal(nodes(root).filter((n) => n.tag === 'button').length, 0);
      app.dispose();
    });
  }
}
test('catalog navigation aborts old reads and fences stale denials and detached controls', async () => {
  const root = new Element();
  let finish: (r: Response) => void = () => assert.fail('not pending');
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  const app = mountManagementOperations(
    root,
    async (path, init) => {
      calls++;
      if (path !== '/management/v1/models') return empty();
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
    adapter,
  );
  await tick();
  click(root, 'Models');
  assert.equal(signal?.aborted, false);
  click(root, 'History');
  await tick();
  assert.equal(signal?.aborted, true);
  finish(new Response(null, { status: 403 }));
  await tick();
  assert.match(text(root), /No history matches/);
  assert.doesNotMatch(text(root), /Access denied/);
  click(root, 'Models');
  app.dispose();
  assert.equal(signal?.aborted, true);
  const before = calls;
  finish(catalog());
  await tick();
  assert.equal(calls, before);
  assert.equal(root.children.length, 0);
});

async function fixture() {
  const jwt = await createSsoAccessTokenFixture();
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`
      INSERT INTO iam_principals VALUES ('human', 'human', true);
      INSERT INTO iam_policies VALUES ('allow', 'v1',
        '[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider"],"resources":["model:*","provider:openai"]}]');
      INSERT INTO iam_roles VALUES ('reader');
      INSERT INTO iam_principal_roles VALUES ('human', 'reader');
      INSERT INTO iam_role_policies VALUES ('reader', 'allow');
      INSERT INTO catalog_models (alias, created_at_seconds, enabled) VALUES ('team/chat', 42, true);
      INSERT INTO catalog_routes (route_id, alias, kind, version, credential_ref, candidates) VALUES
        ('direct', 'team/chat', 'managed', 'v1', NULL,
         '[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-secret"}]');
      UPDATE catalog_models SET active_route_id = 'direct' WHERE alias = 'team/chat';
    `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  let sequence = 0;
  const ports = {
    ...jwt.config,
    client: { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) },
    newRequestId: () => `composed-${++sequence}`,
  };
  const token = await jwt.token();
  const request = (suffix = '', authenticated = true) =>
    new Request(`http://localhost/management/v1/models${suffix}`, {
      headers: {
        ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
        'x-request-id': 'client-forged',
      },
    });
  return { db, ports, request, token };
}

test('operations DOM through owned HTTP and migrated SQL reflects fresh IAM and durable audit', async () => {
  const f = await fixture();
  const server = createPostgresSsoModelCatalogServer(f.ports);
  const root = new Element();
  let app: ReturnType<typeof mountManagementOperations> | undefined;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    app = mountManagementOperations(
      root,
      async (path, init) => {
        // This catalog-only owned listener intentionally does not implement history.
        if (!path.startsWith('/management/v1/models')) return empty();
        return fetch(`http://127.0.0.1:${address.port}${path}`, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${f.token}` },
        });
      },
      adapter,
    );
    const until = async (pattern: RegExp) => {
      for (let i = 0; i < 200; i++) {
        if (pattern.test(text(root))) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.match(text(root), pattern);
    };
    await tick();
    click(root, 'Models');
    await until(/team\/chat/);
    click(root, 'team/chat');
    await until(/Back to models/);
    assert.doesNotMatch(text(root), /private-secret/);
    await f.db.exec(`UPDATE iam_policies SET version = 'v2', statements =
      '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:*"]}]' WHERE policy_id = 'allow'`);
    click(root, 'Back to models');
    await until(/No models available/);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    click(root, 'Models');
    await until(/Sign-in required/);
    assert.equal(nodes(root).filter((n) => n.tag === 'button').length, 0);
    const rows = (
      await f.db.query<{ outcome: string; policy_versions: unknown }>(
        'SELECT outcome, policy_versions FROM sso_catalog_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.equal(rows.length, 4);
    assert.equal(rows[0]?.outcome, 'ready');
    assert.deepEqual(rows[2]?.policy_versions, [{ id: 'allow', version: 'v2' }]);
    assert.equal(rows[3]?.outcome, 'unauthenticated');
  } finally {
    app?.dispose();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await f.db.close();
  }
});
