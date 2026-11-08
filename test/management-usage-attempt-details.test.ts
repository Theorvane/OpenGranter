import assert from 'node:assert/strict';
import test from 'node:test';
import { mountManagementUsage, type UsageElement } from '../src/management/usage-app.ts';
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

import { buildManagementBrowser } from '../scripts/build-management-browser.ts';

for (const artifact of [false, true]) {
  test('attempt billing evidence: ' + (artifact ? 'browser artifact' : 'source'), async () => {
    const mount = artifact
      ? ((
          await import(
            'data:text/javascript;base64,' +
              Buffer.from(
                await buildManagementBrowser({
                  root: process.cwd(),
                  entry: 'src/management/usage-app.ts',
                }),
              ).toString('base64')
          )
        ).mountManagementUsage as typeof mountManagementUsage)
      : mountManagementUsage;
    const root = new Element();
    const app = mount(root);
    const policies = [
      { id: 'policy/<img src=x>', version: 'v:1' },
      { id: 'policy', version: '<img src=x>' },
      { id: 'policy/<img src=x>', version: 'v:1' },
    ];
    let calls = 0;
    const record = buildUsageRecord({
      principalId: 'human',
      credentialId: 'reference-only',
      policyVersions: policies,
      requestId: 'req',
      attemptId: 'attempt',
      modelAlias: 'model',
      routeKind: 'managed',
      upstreamModelId: 'upstream',
      selectedCandidateId: 'candidate',
      occurredAt: 1,
      latencyMs: 0,
      outcome: 'succeeded',
      possiblyBilled: false,
      possibleDuplicate: false,
      providerUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      estimatedCost: {
        amountDecimal: '0.000000000000000001',
        currency: 'USD',
        priceVersion: 'price-v1',
      },
      upstreamBilledCost: { amountDecimal: '0', currency: 'EUR', source: 'direct-provider' },
    });
    async function connect(empty = false) {
      await app.connect(async () => {
        calls++;
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [
              {
                ...record,
                policyVersions: policies,
                outcome: empty ? 'failed' : 'succeeded',
                possiblyBilled: empty,
                possibleDuplicate: empty,
                estimatedCost: empty ? null : record.estimatedCost,
                upstreamBilledCost: empty ? null : record.upstreamBilledCost,
                usage: {
                  ...record.usage,
                  status: empty ? 'partial' : 'reported',
                  totalTokens: empty ? null : 0,
                },
                rawSecret: 'never-display-private-extra',
              },
            ],
            has_more: false,
            next_cursor: null,
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      });
    }
    try {
      await connect();
      const details = root
        .all()
        .filter(
          (node) => node.tag === 'details' && node.children[0]?.textContent === 'Inspect attempt',
        );
      assert.ok(details.length > 0);
      for (const detail of details) {
        assert.match(detail.text(), /Total tokens 0/);
        assert.match(detail.text(), /Usage status reported/);
        assert.match(detail.text(), /Estimated cost 0\.000000000000000001 USD/);
        assert.match(detail.text(), /Reported cost 0 EUR/);
        assert.match(detail.text(), /Possibly billed No/);
        assert.match(detail.text(), /Server-marked possible duplicate No/);
        assert.match(detail.text(), /not settled billing or reconciliation/);
        assert.doesNotMatch(detail.text(), /reference-only|policy\/|v:1/);
      }
      assert.equal(calls, 1, 'no policy or credential lookup');
      assert.ok(!root.all().some((node) => node.tag === 'img'));
      assert.doesNotMatch(root.text(), /never-display-private-extra/);
      app.clear('expired');
      assert.doesNotMatch(root.text(), /reference-only|Policy ID|Inspect attempt|price-v1|0 EUR/);
      await connect(true);
      assert.match(root.text(), /Estimated cost Unknown/);
      assert.match(root.text(), /Reported cost Unknown/);
      assert.match(root.text(), /Total tokens Unknown/);
      assert.match(root.text(), /Possibly billed Yes/);
      assert.match(root.text(), /Server-marked possible duplicate Yes/);
      assert.match(root.text(), /Usage status partial/);
      assert.doesNotMatch(root.text(), /reference-only|v:1/);
      assert.equal(calls, 2);
    } finally {
      app.dispose();
    }
  });
}
