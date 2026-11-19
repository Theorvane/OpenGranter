import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSsoAuditReview, mountSsoUsageReview } from '../src/management/review-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  children: Element[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: () => new Element() };
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  focus() {}
}
function nodes(root: Element): Element[] {
  return [root, ...root.children.flatMap(nodes)];
}
function text(root: Element) {
  return nodes(root)
    .map((node) => node.textContent ?? '')
    .join(' ');
}
function click(root: Element, label: string) {
  const node = nodes(root).find((node) => node.textContent === label);
  assert.ok(node);
  assert.equal(node.attributes.disabled, undefined);
  assert.ok(node.listeners.click);
  node.listeners.click();
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
for (const kind of ['usage', 'audit'] as const) {
  test(`${kind} DOM renders safe ready rows, next/back and explicit current-page CSV`, async () => {
    const root = new Element();
    const paths: string[] = [];
    let delivered = '';
    const mount = kind === 'usage' ? mountSsoUsageReview : mountSsoAuditReview;
    const app = mount(
      root,
      async (url) => {
        paths.push(url);
        const query = new URL(url, 'https://local.invalid').searchParams;
        if (query.get('format') === 'csv')
          return new Response('safe,csv\n', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          });
        const more = !query.has('cursor');
        const row =
          kind === 'audit'
            ? {
                eventId: more ? '9007199254740993' : '9007199254740992',
                occurredAt: 100,
                kind: 'models-listed',
                requestId: 'req-1',
                principalId: 'human',
                credentialId: 'old',
                policyVersions: [],
                details: { count: 1, prompt: 'PRIVATE' },
              }
            : buildUsageRecord({
                principalId: 'human',
                credentialId: 'old',
                policyVersions: [],
                requestId: '<img src=x>',
                attemptId: more ? 'z' : 'a',
                modelAlias: 'chat',
                routeKind: 'managed',
                upstreamModelId: 'upstream',
                selectedCandidateId: 'candidate',
                occurredAt: 100,
                latencyMs: 1,
                outcome: 'succeeded',
                possiblyBilled: true,
                possibleDuplicate: true,
                estimatedCost: {
                  amountDecimal: '9007199254740993.0001',
                  currency: 'USD',
                  priceVersion: 'v1',
                },
              });
        return Response.json({
          object: 'list',
          data: [{ ...row, secret: 'PRIVATE' }],
          has_more: more,
          next_cursor: more
            ? kind === 'audit'
              ? '9007199254740993'
              : Buffer.from(JSON.stringify([100, 'z'])).toString('base64url')
            : null,
        });
      },
      (csv) => {
        delivered = csv;
      },
    );
    await app.load({ limit: 1 });
    assert.equal(paths.length, 1);
    assert.doesNotMatch(text(root), /PRIVATE/);
    if (kind === 'usage') {
      assert.match(text(root), /9007199254740993\.0001 USD/);
      assert.match(text(root), /Unknown/);
      assert.ok(nodes(root).some((node) => node.textContent === '<img src=x>'));
    } else assert.match(text(root), /9007199254740993/);
    click(root, 'Next page');
    await tick();
    assert.ok(paths[1]?.includes('cursor='));
    click(root, 'Export current page CSV');
    await tick();
    assert.equal(delivered, 'safe,csv\n');
    assert.equal(
      new URL(paths[2] ?? '', 'https://local.invalid').searchParams.get('cursor'),
      new URL(paths[1] ?? '', 'https://local.invalid').searchParams.get('cursor'),
    );
    click(root, 'Previous page');
    await tick();
    assert.equal(paths[3], paths[0]);
    app.dispose();
    assert.equal(root.children.length, 0);
  });
}
