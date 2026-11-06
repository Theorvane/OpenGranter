import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountManagementAudit } from '../src/management/audit-app.ts';
import type { UsageElement } from '../src/management/usage-app.ts';

class Element implements UsageElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attrs: Record<string, string> = {};
  events: Record<string, () => void> = {};
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
  addEventListener(key: string, callback: () => void) {
    this.events[key] = callback;
  }
  focus() {}
  all(): Element[] {
    return [this, ...this.children.flatMap((n) => n.all())];
  }
  text() {
    return this.all()
      .map((n) => n.textContent ?? '')
      .join(' ');
  }
  button(text: string) {
    const button = this.all().find((n) => n.tag === 'button' && n.textContent === text);
    assert.ok(button, text);
    return button;
  }
}
const event = (eventId: string, requestId: string) => ({
  eventId,
  requestId,
  occurredAt: 1000,
  kind: 'models-listed',
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [{ id: 'policy', version: 'v1' }],
  details: { count: 1, prompt: 'PRIVATE_PROMPT' },
});
const response = (data: unknown[], cursor: string | null = null) =>
  Response.json({
    object: 'list',
    data,
    has_more: cursor !== null,
    next_cursor: cursor,
  });
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), 'UI settled');
}
for (const bundled of [false, true]) {
  test(`audit request trace renders authorized page only and resets across page/lifecycle (${bundled ? 'supported artifact' : 'source'})`, async () => {
    const mount = bundled
      ? ((
          await import(
            `data:text/javascript;base64,${Buffer.from(await buildManagementBrowser({ root: resolve('.'), entry: 'src/management/audit-app.ts' })).toString('base64')}`
          )
        ).mountManagementAudit as typeof mountManagementAudit)
      : mountManagementAudit;
    const root = new Element();
    let calls = 0;
    let time = 100;
    const app = mount(root, { now: () => time, schedule: () => () => {} });
    const request = async () => {
      calls++;
      return calls === 1
        ? response([event('9', 'shared'), event('8', 'other'), event('7', 'shared')], '7')
        : response([event('6', 'next-page')]);
    };
    try {
      await app.authorize({ expiresAt: 200, request });
      let trace = root
        .all()
        .find((n) => n.attrs['aria-label'] === 'Current page audit request correlation');
      assert.ok(trace, 'current-page request correlation is an actual audit-screen view');
      assert.match(trace.text(), /not complete request history/);
      const groups = trace.children.filter((n) => n.tag === 'details');
      assert.equal(groups.length, 2);
      assert.match(groups[0]?.text() ?? '', /Request: shared/);
      assert.match(groups[0]?.text() ?? '', /Events on this page: 2/);
      assert.doesNotMatch(groups[0]?.text() ?? '', /Request: other/);
      assert.doesNotMatch(trace.text(), /PRIVATE/);
      assert.equal(calls, 1, 'expansion adds no hidden network requests');
      root.button('Next page').events.click?.();
      await until(() => root.text().includes('next-page'));
      trace = root
        .all()
        .find((n) => n.attrs['aria-label'] === 'Current page audit request correlation');
      assert.ok(trace);
      assert.doesNotMatch(trace.text(), /Request: shared|Request: other/);
      assert.equal(calls, 2);
      const refresh = root.button('Refresh current page');
      time = 200;
      refresh.events.click?.();
      assert.match(root.text(), /Session expired/);
      assert.doesNotMatch(root.text(), /next-page|Request correlation/);
      assert.equal(calls, 2);
      await app.connect(async () => response([]));
      assert.match(root.text(), /No audit events/);
      assert.ok(
        !root.all().some((n) => n.attrs['aria-label'] === 'Current page audit request correlation'),
      );
      app.clear();
      assert.doesNotMatch(root.text(), /Request correlation/);
    } finally {
      app.dispose();
    }
  });
}

test('audit correlation uses exact compound identity, preserves repeats/order/bigint IDs and renders text only', async () => {
  const { renderAuditRequestGroups } = await import('../src/management/audit-request-groups.ts');
  // Delimiter-like pairs and identical request IDs on different principals must remain distinct.
  const data = [
    { ...event('9223372036854775807', 'b:c'), principalId: 'a' },
    { ...event('9223372036854775806', 'c'), principalId: 'a:b' },
    { ...event('9', 'b:c'), principalId: 'different' },
    { ...event('8', 'b:c'), principalId: 'a' },
    { ...event('8', 'b:c'), principalId: 'a' },
    { ...event('7', '<img src=x onerror=alert(1)>'), principalId: '<script>text</script>' },
  ];
  // Renderer receives the already validated shape. Direct construction here tests
  // grouping across principals; the client itself rejects mixed-principal pages.
  const rows = data.map((row) => ({ ...row, details: { count: 1 } }));
  const root = new Element();
  const trace = renderAuditRequestGroups(root.ownerDocument, rows) as Element;
  const groups = trace.children.filter((n) => n.tag === 'details');
  assert.equal(groups.length, 4);
  assert.equal(groups[0]?.children[1]?.textContent, 'Events on this page: 3');
  assert.deepEqual(
    groups[0]?.children.filter((n) => n.tag === 'section').map((n) => n.children[0]?.textContent),
    ['Event: 9223372036854775807', 'Event: 8', 'Event: 8'],
  );
  assert.match(groups[1]?.text() ?? '', /Principal: a:b/);
  assert.match(groups[2]?.text() ?? '', /Principal: different/);
  assert.match(groups[3]?.text() ?? '', /<img src=x onerror=alert\(1\)>/);
  assert.ok(!trace.all().some((n) => ['img', 'script', 'a'].includes(n.tag)));
  assert.ok(trace.all().every((n) => Object.keys(n.events).length === 0));
  assert.equal(
    JSON.stringify(rows),
    JSON.stringify(data.map((row) => ({ ...row, details: { count: 1 } }))),
  );
});

test('audit request traces are removed on renewal, denial, failed reads and disposal', async () => {
  const root = new Element();
  const app = mountManagementAudit(root);
  let release!: (value: Response) => void;
  try {
    await app.connect(async () => response([event('9', 'old-authority')]));
    assert.match(root.text(), /Request: old-authority/);
    const pending = app.connect(
      async () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    assert.match(root.text(), /Loading audit/);
    assert.doesNotMatch(root.text(), /Request: old-authority/);
    await app.connect(async () => response([event('8', 'new-authority')]));
    await pending;
    release(response([event('9', 'late-private')]));
    await until(() => root.text().includes('Request: new-authority'));
    assert.doesNotMatch(root.text(), /old-authority|late-private/);
    for (const status of [403, 401, 503]) {
      await app.connect(async () => new Response('PRIVATE_FAILURE', { status }));
      assert.doesNotMatch(root.text(), /Request correlation|new-authority|PRIVATE_FAILURE/);
    }
    await app.connect(async () => response([event('8', 'unmount-me')]));
    assert.match(root.text(), /Request: unmount-me/);
  } finally {
    app.dispose();
  }
  assert.equal(root.children.length, 0);
});
