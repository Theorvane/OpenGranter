import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
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
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function record(id: string, amount?: string, currency = 'USD', billed?: string) {
  return buildUsageRecord({
    principalId: 'human',
    credentialId: 'cred',
    policyVersions: [],
    requestId: id,
    attemptId: id,
    occurredAt: 100,
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'upstream',
    selectedCandidateId: 'candidate',
    latencyMs: 1,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: true,
    ...(amount === undefined
      ? {}
      : { estimatedCost: { amountDecimal: amount, currency, priceVersion: 'v1' } }),
    ...(billed === undefined
      ? {}
      : {
          upstreamBilledCost: {
            amountDecimal: billed,
            currency,
            source: 'direct-provider' as const,
          },
        }),
  });
}
function response(data: ReturnType<typeof record>[], more = false) {
  return Response.json({
    object: 'list',
    data,
    has_more: more,
    next_cursor: more
      ? Buffer.from(JSON.stringify([100, data.at(-1)?.attemptId])).toString('base64url')
      : null,
  });
}
const download = () => ({ save: () => 'started' as const, dispose() {} });
const summary = (root: Element) =>
  nodes(root).find((n) => n.attributes['aria-label'] === 'Current page cost summary');

test('canonical history totals only validated current page costs exactly and separately by currency', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async () => {
      calls++;
      return response([
        record('z', '9007199254740993.0000000001', 'USD', '0.1'),
        record('y', '0.0000000002', 'USD', '0.2'),
        record('x', '2.50', 'EUR', '0'),
        record('w'),
      ]);
    },
    download(),
  );
  await tick();
  const view = summary(root);
  assert.ok(view, 'canonical ready usage must render current-page summary');
  const result = text(view);
  assert.match(result, /Estimated totals: 2.5 EUR; 9007199254740993.0000000003 USD/);
  assert.match(result, /Reported totals: 0 EUR; 0.3 USD/);
  assert.match(result, /Estimated cost coverage: 3 of 4 records/);
  assert.match(result, /Reported cost coverage: 3 of 4 records/);
  assert.match(result, /Missing usage: 4/);
  assert.match(result, /Possibly billed: 4/);
  assert.match(result, /Possible duplicates: 4 \(included, not deduplicated\)/);
  assert.match(result, /not an invoice or all-pages total/);
  assert.equal(calls, 1);
  app.dispose();
  assert.equal(summary(root), undefined);
});

test('explicit zero differs from missing cost and summary disappears during fresh page and failure', async () => {
  const root = new Element();
  let calls = 0;
  let finish: (r: Response) => void = () => assert.fail('not pending');
  const app = mountHistoryWorkspace(
    root,
    async () => {
      calls++;
      if (calls === 1) return response([record('z', '0')], true);
      return new Promise<Response>((r) => {
        finish = r;
      });
    },
    download(),
  );
  await tick();
  assert.match(text(summary(root)!), /Estimated totals: 0 USD/);
  assert.match(text(summary(root)!), /Reported totals: Unknown/);
  click(root, 'Next page');
  assert.equal(summary(root), undefined);
  finish(response([record('y')]));
  await tick();
  assert.match(text(summary(root)!), /Estimated totals: Unknown/);
  assert.match(text(summary(root)!), /Estimated cost coverage: 0 of 1 records/);
  click(root, 'Refresh current page');
  assert.equal(summary(root), undefined);
  finish(new Response(null, { status: 503 }));
  await tick();
  assert.equal(summary(root), undefined);
  assert.match(text(root), /History unavailable/);
  app.dispose();
});

for (const state of ['empty', 'denied', 'audit'] as const) {
  test('page summary is absent after ' + state, async () => {
    const root = new Element();
    let calls = 0;
    const app = mountHistoryWorkspace(
      root,
      async () => {
        calls++;
        return calls === 1
          ? response([record('z', '1')])
          : state === 'denied'
            ? new Response(null, { status: 403 })
            : response([]);
      },
      download(),
    );
    await tick();
    assert.ok(summary(root));
    click(root, state === 'audit' ? 'Audit' : 'Refresh current page');
    assert.equal(summary(root), undefined);
    await tick();
    assert.equal(summary(root), undefined);
    if (state === 'denied') assert.match(text(root), /Access denied/);
    app.dispose();
  });
}

test('usage availability and malformed response are never inferred from cost coverage', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async () => {
      calls++;
      if (calls > 1)
        return Response.json({
          object: 'list',
          data: [
            {
              ...record('bad'),
              estimatedCost: { amountDecimal: 'NaN', currency: 'USD', priceVersion: 'v1' },
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      return response([
        {
          ...record('z'),
          usage: { status: 'reported', promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
        {
          ...record('y'),
          usage: { status: 'partial', promptTokens: 2, completionTokens: null, totalTokens: null },
        },
        {
          ...record('x'),
          usage: {
            status: 'invalid',
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
          },
        },
      ]);
    },
    download(),
  );
  await tick();
  assert.ok(summary(root));
  const view = text(summary(root)!);
  for (const line of [
    'Reported usage: 1',
    'Partial usage: 1',
    'Invalid usage: 1',
    'Missing usage: 0',
    'Estimated totals: Unknown',
    'Reported totals: Unknown',
  ])
    assert.ok(view.includes(line), line);
  click(root, 'Refresh current page');
  await tick();
  assert.equal(summary(root), undefined);
  assert.match(text(root), /History unavailable/);
  app.dispose();
});
