import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { serializeAuditCsv } from '../src/audit/csv.ts';
import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../src/audit/history-public.ts';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { mountManagementAudit } from '../src/management/audit-app.ts';
import { createManagementAuditClient } from '../src/management/audit-client.ts';
import type { UsageElement } from '../src/management/usage-app.ts';

class Element implements UsageElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, (event?: { preventDefault(): void }) => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  addEventListener(type: string, listener: (event?: { preventDefault(): void }) => void) {
    this.listeners[type] = listener;
  }
  click() {
    this.listeners.click?.();
  }
  focus() {}
  all(): Element[] {
    return [this, ...this.children.flatMap((node) => node.all())];
  }
  text(): string {
    return this.all()
      .map((node) => node.textContent ?? '')
      .join(' ');
  }
  button(text: string) {
    const found = this.all().find((n) => n.tag === 'button' && n.textContent === text);
    assert.ok(found, text);
    return found;
  }
  input(label: string) {
    const found = this.all().find((n) => n.tag === 'label' && n.textContent === label)?.children[0];
    assert.ok(found, label);
    return found;
  }
}
const row = {
  eventId: '8',
  occurredAt: 1000,
  kind: 'route-unavailable',
  requestId: 'request/team:1+v@a',
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [],
  details: { modelAlias: 'team/model' },
};
const reply = (id = '8', more = false) =>
  Response.json({
    object: 'list',
    data: [{ ...row, eventId: id }],
    has_more: more,
    next_cursor: more ? id : null,
  });
async function settled(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), 'UI settled');
}

test('request parser is strict and projection/CSV reject off-filter data', () => {
  const query = parseAuditHistoryQuery(
    new URL('http://local/v1/audit?request_id=' + encodeURIComponent(row.requestId)),
  );
  assert.equal(query.requestId, row.requestId);
  for (const bad of ['', ' ', 'bad id', "x' OR true", '%', '\n', 'x'.repeat(257)])
    assert.throws(() =>
      parseAuditHistoryQuery(
        new URL('http://local/v1/audit?request_id=' + encodeURIComponent(bad)),
      ),
    );
  assert.throws(() =>
    parseAuditHistoryQuery(new URL('http://local/v1/audit?request_id=a&request_id=b')),
  );
  const page = { events: [row], nextCursor: null };
  assert.equal(
    projectAuditHistoryPage(page, 'human', 10, null, { requestId: row.requestId }).events.length,
    1,
  );
  assert.throws(() => projectAuditHistoryPage(page, 'human', 10, null, { requestId: 'other' }));
  assert.throws(() => serializeAuditCsv(page, 'human', { limit: 10, requestId: 'other' }));
});

test('browser client carries exact request filter and rejects injected mismatch', async () => {
  let path = '';
  const client = createManagementAuditClient(async (url) => {
    path = url;
    return reply();
  });
  assert.equal((await client.list({ requestId: row.requestId })).state, 'ready');
  assert.equal(new URL(path, 'http://local').searchParams.get('request_id'), row.requestId);
  assert.equal((await client.list({ requestId: 'other' })).state, 'unavailable');
  path = '';
  assert.equal((await client.list({ requestId: 'bad id' })).state, 'invalid_query');
  assert.equal(path, '');
});

for (const artifact of [false, true])
  test(
    'request trace action and exact filter lifecycle ' + (artifact ? 'artifact' : 'source'),
    async () => {
      const mount = artifact
        ? ((
            await import(
              'data:text/javascript;base64,' +
                Buffer.from(
                  await buildManagementBrowser({
                    root: process.cwd(),
                    entry: 'src/management/audit-app.ts',
                  }),
                ).toString('base64')
            )
          ).mountManagementAudit as typeof mountManagementAudit)
        : mountManagementAudit;
      const root = new Element();
      let time = 1;
      const seen: URLSearchParams[] = [];
      let mode = 'ready';
      let finish: ((r: Response) => void) | undefined;
      const app = mount(root, { now: () => time, schedule: () => () => {} });
      const request = async (path: string) => {
        const q = new URL(path, 'http://local').searchParams;
        seen.push(q);
        if (mode === 'pending')
          return new Promise<Response>((r) => {
            finish = r;
          });
        if (mode === 'denied') return new Response('private failure', { status: 403 });
        if (q.get('format') === 'csv')
          return new Response('safe,csv', {
            headers: {
              'content-type': 'text/csv',
              'x-has-more': q.get('cursor') === '6' ? 'false' : 'true',
              ...(q.get('cursor') === '6' ? {} : { 'x-next-cursor': '6' }),
            },
          });
        return reply(q.has('cursor') ? '7' : '8', !q.has('cursor'));
      };
      const trace = () => root.button('Trace audit request ' + row.requestId);
      try {
        await app.authorize({ request, expiresAt: 100 });
        root.input('Principal ID').value = 'human';
        root.input('Model').value = 'team/model';
        root.input('From (UTC)').value = '1970-01-01T00:00:00.001';
        root.input('To (UTC, exclusive)').value = '1970-01-01T00:00:02';
        root.input('Page size (1–100)').value = '2';
        root.button('Apply filters').click();
        await settled(() => root.text().includes('Audit events — current page'));
        root.button('Next page').click();
        await settled(() => root.text().includes('Previous page'));
        root.button('Export current page CSV').click();
        await settled(() => root.text().includes('Download audit.csv'));
        const stale = trace();
        root.input('Request ID').value = 'unsubmitted';
        trace().click();
        await settled(() => root.text().includes('Audit events — current page'));
        const q = seen.at(-1);
        assert.equal(q?.get('request_id'), row.requestId);
        assert.equal(q?.get('principal_id'), 'human');
        assert.equal(q?.get('model'), 'team/model');
        assert.equal(q?.get('from_ms'), '1');
        assert.equal(q?.get('to_ms'), '2000');
        assert.equal(q?.get('limit'), '2');
        assert.equal(q?.has('cursor'), false);
        assert.equal(root.input('Request ID').value, row.requestId);
        assert.doesNotMatch(root.text(), /Previous page|Download audit.csv/);
        let count = seen.length;
        stale.click();
        assert.equal(seen.length, count);
        root.button('Export current page CSV').click();
        await settled(() => root.text().includes('Download audit.csv'));
        assert.equal(seen.at(-1)?.get('request_id'), row.requestId);
        root.button('Export next CSV page').click();
        await settled(() => seen.at(-1)?.get('cursor') === '6');
        assert.equal(seen.at(-1)?.get('request_id'), row.requestId);
        await settled(() => root.text().includes('Download audit.csv'));
        root.input('Request ID').value = 'bad id';
        count = seen.length;
        root.button('Apply filters').click();
        await settled(() => root.text().includes('Invalid audit filters'));
        assert.equal(seen.length, count);
        assert.equal(root.input('Request ID').value, 'bad id');
        root.input('Request ID').value = row.requestId;
        root.button('Apply filters').click();
        await settled(() => root.text().includes('Audit events — current page'));
        assert.equal(seen.at(-1)?.get('request_id'), row.requestId);
        const expired = trace();
        time = 100;
        count = seen.length;
        expired.click();
        assert.equal(seen.length, count);
        assert.match(root.text(), /Session expired/);
        time = 1;
        await app.authorize({ request, expiresAt: 100 });
        mode = 'denied';
        trace().click();
        await settled(() => root.text().includes('Access denied'));
        assert.doesNotMatch(root.text(), /private failure|Request correlation/);
        mode = 'ready';
        await app.authorize({ request, expiresAt: 100 });
        mode = 'pending';
        trace().click();
        app.clear();
        assert.ok(finish);
        finish(reply());
        await new Promise((r) => setTimeout(r, 20));
        assert.doesNotMatch(root.text(), /Audit events — current page/);
        mode = 'ready';
        await app.authorize({ request, expiresAt: 100 });
        const detached = trace();
        count = seen.length;
        app.dispose();
        detached.click();
        assert.equal(seen.length, count);
        assert.equal(root.text(), '');
      } finally {
        app.dispose();
      }
    },
  );

test('migrated SQL + authenticated handler intersects principal/model/time/request across JSON and CSV keysets', async () => {
  const db = new PGlite();
  await db.exec(await readFile('migrations/003_gateway_audit.sql', 'utf8'));
  let reads = 0;
  let deny = false;
  let failAudit = false;
  const sql = {
    query: (text: string, params: readonly unknown[]) => {
      if (text.includes('SELECT event_id')) reads++;
      return db.query(text, [...params]);
    },
  };
  const writer = createPostgresGatewayAuditStore(sql, () => 1000);
  const reader = createPostgresAuditHistoryReader(sql);
  const handler = createChatHandler({
    newRequestId: () => 'read-request',
    authenticate: async () => ({
      id: 'human',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: [
        {
          effect: deny ? ('Deny' as const) : ('Allow' as const),
          actions: ['audit:Read'],
          resources: ['principal:human'],
        },
      ],
    }),
    resolveRoute: async () => {
      throw Error('no inference');
    },
    checkLimit: async () => {
      throw Error('no limits');
    },
    resolveSecret: async () => {
      throw Error('no secrets');
    },
    invokeDirect: async () => {
      throw Error('no inference');
    },
    writeUsage: async () => {
      throw Error('no usage');
    },
    writeAudit: async (event) => {
      if (failAudit) throw Error('private audit failure');
      await writer.append(event);
    },
    listAudit: reader,
  });
  const server = createNodeRequestServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = 'http://127.0.0.1:' + address.port;
  const get = (query = '', base = '/v1') =>
    fetch(
      origin +
        base +
        '/audit?principal_id=human&model=team%2Fmodel&from_ms=1&to_ms=2000&limit=1&request_id=' +
        encodeURIComponent(row.requestId) +
        query,
      { headers: { authorization: 'Bearer test-credential' } },
    );
  try {
    for (const [principalId, requestId, modelAlias] of [
      ['human', row.requestId, 'team/model'],
      ['human', 'other', 'team/model'],
      ['human', row.requestId, 'other'],
      ['other', row.requestId, 'team/model'],
      ['human', row.requestId, 'team/model'],
    ] as const)
      await writer.append({
        kind: 'route-unavailable',
        principalId,
        credentialId: 'credential',
        policyVersions: [],
        requestId,
        modelAlias,
      });
    let response = await get();
    assert.equal(response.status, 200);
    const first = (await response.json()) as {
      data: { eventId: string }[];
      has_more: boolean;
      next_cursor: string;
    };
    assert.equal(first.data.length, 1);
    assert.equal(first.data[0]?.eventId, '5');
    assert.equal(first.has_more, true);
    response = await get('&cursor=' + first.next_cursor);
    assert.equal(response.status, 200);
    const second = (await response.json()) as { data: { eventId: string }[]; has_more: boolean };
    assert.equal(second.data[0]?.eventId, '1');
    assert.equal(second.has_more, false);
    response = await get('&format=csv');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-next-cursor'), '5');
    assert.match(await response.text(), /request\/team:1\+v@a/);
    response = await get('&format=csv&cursor=5');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-has-more'), 'false');
    await response.text();
    const audit = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM gateway_audit_events WHERE kind='audit-history-read'",
    );
    assert.equal(audit.rows[0]?.count, 4);
    deny = true;
    const before = reads;
    response = await get();
    assert.equal(response.status, 403);
    assert.equal(reads, before);
    await response.text();
    deny = false;
    failAudit = true;
    response = await get();
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /request\/team|private audit/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});

test('SQL request predicate is bound and mismatched lookahead fails closed', async () => {
  const stored = {
    event_id: '8',
    occurred_at_ms: '1000',
    kind: row.kind,
    request_id: row.requestId,
    principal_id: row.principalId,
    credential_id: row.credentialId,
    policy_versions: [],
    details: row.details,
  };
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const reader = createPostgresAuditHistoryReader({
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: [stored, { ...stored, event_id: '7', request_id: 'other' }] };
    },
  });
  await assert.rejects(reader({ principalId: 'human', limit: 1, requestId: row.requestId }), {
    name: 'AuditHistoryUnavailable',
  });
  assert.match(calls[0]?.text ?? '', /request_id = \$7::text/);
  assert.equal(calls[0]?.params[6], row.requestId);
  assert.equal(calls[0]?.text.includes(row.requestId), false);
  calls.length = 0;
  await assert.rejects(reader({ principalId: 'human', limit: 1, requestId: "x' OR true" }));
  assert.equal(calls.length, 0);
});
