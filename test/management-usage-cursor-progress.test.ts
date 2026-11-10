import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { mountManagementUsage, type UsageElement } from '../src/management/usage-app.ts';
import { createManagementUsageClient } from '../src/management/usage-client.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

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
    const found = this.all().find((node) => node.tag === 'button' && node.textContent === text);
    assert.ok(found, text);
    return found;
  }
}

const row = buildUsageRecord({
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [],
  requestId: 'request',
  attemptId: 'attempt',
  modelAlias: 'chat/model',
  routeKind: 'managed',
  upstreamModelId: 'model',
  selectedCandidateId: 'candidate',
  occurredAt: 2,
  latencyMs: 10,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: false,
});
const current = 'opaque-current_-';
const next = 'opaque-next_-';
function response(format: 'json' | 'csv', cursor: string | null) {
  return format === 'json'
    ? Response.json({ object: 'list', data: [row], has_more: cursor !== null, next_cursor: cursor })
    : new Response('request_id\r\nrequest\r\n', {
        headers: {
          'content-type': 'text/csv',
          'x-usage-has-more': String(cursor !== null),
          ...(cursor === null ? {} : { 'x-usage-next-cursor': cursor }),
        },
      });
}
for (const format of ['json', 'csv'] as const) {
  test(
    format + ' rejects a stalled opaque continuation, accepts distinct and terminal cursors',
    async () => {
      for (const returned of [current, next, null]) {
        let calls = 0;
        const client = createManagementUsageClient(async (path) => {
          calls++;
          assert.equal(new URL(path, 'https://local').searchParams.get('cursor'), current);
          return response(format, returned);
        });
        const result = await (format === 'json'
          ? client.list({ cursor: current })
          : client.csv({ cursor: current }));
        assert.equal(result.state, returned === current ? 'unavailable' : 'ready');
        if (result.state === 'ready') assert.equal(result.data.nextCursor, returned);
        else assert.deepEqual(result, { state: 'unavailable' });
        assert.equal(calls, 1); // No invented cursor or automatic retry.
        client.invalidate();
      }
    },
  );
  test(format + ' compares the captured cursor, not a mutated caller object', async () => {
    let release!: (response: Response) => void;
    const client = createManagementUsageClient(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const filters = { cursor: current };
    const pending = format === 'json' ? client.list(filters) : client.csv(filters);
    filters.cursor = next;
    release(response(format, current));
    assert.deepEqual(await pending, { state: 'unavailable' });
    client.invalidate();
  });
}
async function waitFor(predicate: () => boolean) {
  for (let count = 0; count < 200; count++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Expected usage state did not arrive');
}
for (const format of ['json', 'csv'] as const) {
  test(
    'loopback ' + format + ' stalled continuation clears protected UI and recovers explicitly',
    async () => {
      const seen: URL[] = [];
      let stalled = true;
      const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://local');
        seen.push(url);
        const requestedFormat = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
        const returned = url.searchParams.has('cursor') ? (stalled ? current : null) : current;
        const reply = response(requestedFormat, returned);
        res.writeHead(reply.status, Object.fromEntries(reply.headers));
        res.end(await reply.text());
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('Missing socket');
      const root = new Element();
      const app = mountManagementUsage(root);
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      let allocations = 0;
      const revoked: string[] = [];
      URL.createObjectURL = () => 'blob:test-' + ++allocations;
      URL.revokeObjectURL = (url) => {
        revoked.push(url);
      };
      try {
        await app.connect((path, init) => fetch('http://127.0.0.1:' + address.port + path, init));
        assert.match(root.text(), /chat\/model/);
        if (format === 'json') {
          root.button('Next page').click();
        } else {
          root.button('Export current page CSV').click();
          await waitFor(() => root.text().includes('Download usage.csv'));
          assert.equal(allocations, 1);
          root.button('Export next CSV page').click();
        }
        await waitFor(() => root.text().includes('Retry current page'));
        assert.doesNotMatch(
          root.text(),
          /chat\/model|Download usage.csv|Export next CSV page|Next page/,
        );
        assert.equal(allocations, format === 'csv' ? 1 : 0);
        assert.deepEqual(revoked, format === 'csv' ? ['blob:test-1'] : []);
        const stalledRequest = seen.at(-1)!;
        assert.equal(stalledRequest.searchParams.get('cursor'), current);
        assert.equal(stalledRequest.searchParams.get('format'), format);
        const count = seen.length;
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(seen.length, count); // No automatic following/retry.
        stalled = false;
        root.button('Retry current page').click();
        await waitFor(() => root.text().includes('Export current page CSV'));
        assert.match(root.text(), /chat\/model/);
        // JSON retries the failed page. CSV recovery rereads the currently displayed
        // JSON page, not the failed export continuation, preserving existing UI contract.
        assert.equal(seen.at(-1)!.searchParams.get('cursor'), format === 'json' ? current : null);
        assert.equal(seen.at(-1)!.searchParams.get('format'), 'json');
        assert.equal(seen.length, count + 1);
        assert.doesNotMatch(root.text(), /Download usage.csv/);
      } finally {
        app.dispose();
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
}
