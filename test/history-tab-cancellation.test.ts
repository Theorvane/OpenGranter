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
function page(audit = false, more = false) {
  const row = audit
    ? {
        eventId: '1',
        occurredAt: 100,
        kind: 'models-listed',
        requestId: 'req',
        principalId: 'human',
        credentialId: 'cred',
        policyVersions: [],
        details: { count: 1, prompt: 'PRIVATE' },
      }
    : buildUsageRecord({
        principalId: 'human',
        credentialId: 'cred',
        policyVersions: [],
        requestId: 'req',
        attemptId: 'a',
        occurredAt: 100,
        modelAlias: ' modèle/한글 + &x=1 ',
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        latencyMs: 1,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: true,
        estimatedCost: {
          amountDecimal: '9007199254740993.0000000001',
          currency: 'USD',
          priceVersion: 'v1',
        },
      });
  return Response.json({
    object: 'list',
    data: [row],
    has_more: more,
    next_cursor: more ? Buffer.from(JSON.stringify([100, 'a'])).toString('base64url') : null,
  });
}
function downloads() {
  const saved: [string, string][] = [];
  let disposed = 0;
  return {
    saved,
    get disposed() {
      return disposed;
    },
    save(kind: 'usage' | 'audit', csv: string) {
      saved.push([kind, csv]);
      return 'started' as const;
    },
    dispose() {
      disposed++;
    },
  };
}

for (const kind of ['usage', 'audit'] as const) {
  const destination = kind === 'usage' ? 'Audit' : 'Usage';
  const label = kind === 'usage' ? 'Usage' : 'Audit';
  test(kind + ' pending CSV is aborted on tab switch and never delivered', async () => {
    const root = new Element();
    const download = downloads();
    let finish: ((response: Response) => void) | undefined;
    let signal: AbortSignal | null | undefined;
    const app = mountHistoryWorkspace(
      root,
      async (path, init) => {
        if (new Headers(init.headers).get('accept') === 'text/csv') {
          signal = init.signal;
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        }
        return page(path.includes('audit'));
      },
      download,
    );
    await tick();
    if (kind === 'audit') {
      click(root, label);
      await tick();
    }
    click(root, 'Download current page CSV');
    assert.ok(finish, 'CSV started');
    click(root, destination);
    assert.equal(signal?.aborted, true, 'departing CSV aborted immediately');
    finish(
      new Response('private,csv', {
        headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
      }),
    );
    await tick();
    assert.deepEqual(download.saved, []);
    assert.ok(nodes(root).some((n) => n.tag === 'h2' && n.textContent === destination));
    click(root, label);
    await tick();
    assert.match(text(root), /Applied history query scope/);
    app.dispose();
  });
  test(kind + ' late denial after tab switch cannot revoke fresh destination', async () => {
    const root = new Element();
    let hold = false;
    let finish: ((response: Response) => void) | undefined;
    let signal: AbortSignal | null | undefined;
    const app = mountHistoryWorkspace(
      root,
      async (path, init) => {
        if (hold && path.includes(kind) && new Headers(init.headers).get('accept') === 'text/csv') {
          signal = init.signal;
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        }
        return page(path.includes('audit'));
      },
      downloads(),
    );
    await tick();
    if (kind === 'audit') {
      click(root, label);
      await tick();
    }
    hold = true;
    click(root, 'Download current page CSV');
    assert.ok(finish, 'CSV started');
    click(root, destination);
    assert.equal(signal?.aborted, true, 'departing CSV aborted immediately');
    finish(new Response(null, { status: 403 }));
    await tick();
    assert.ok(nodes(root).some((n) => n.tag === 'h2' && n.textContent === destination));
    assert.match(text(root), /Applied history query scope/);
    hold = false;
    click(root, label);
    await tick();
    assert.match(text(root), /Applied history query scope/);
    app.dispose();
  });
}
