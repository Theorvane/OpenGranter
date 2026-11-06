import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
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

for (const artifact of [false, true]) {
  test('model usage summaries: ' + (artifact ? 'artifact' : 'source'), async () => {
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
    let calls = 0;
    const row = (modelAlias: string, providerUsage?: unknown) =>
      buildUsageRecord({
        principalId: 'human',
        credentialId: 'reference',
        policyVersions: [],
        requestId: 'req',
        attemptId: 'attempt',
        modelAlias,
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        occurredAt: 1,
        latencyMs: 0,
        outcome: 'succeeded',
        possiblyBilled: false,
        possibleDuplicate: true,
        providerUsage,
        estimatedCost: {
          amountDecimal: '0.000000000000000001',
          currency: 'USD',
          priceVersion: 'v1',
        },
      });
    const show = async (data: ReturnType<typeof row>[]) => {
      await app.connect(async () => {
        calls++;
        return new Response(
          JSON.stringify({ object: 'list', data, has_more: false, next_cursor: null }),
          { headers: { 'content-type': 'application/json' } },
        );
      });
    };
    const summary = () => {
      const node = root.all().find((n) => n.attrs['aria-label'] === 'Current page usage by model');
      assert.ok(node);
      return node;
    };
    try {
      const alias = '<img src=x onerror=alert(1)>';
      await show([
        row('alpha', { prompt_tokens: Number.MAX_SAFE_INTEGER }),
        row(alias),
        row('alpha', { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 0 }),
      ]);
      assert.equal(
        summary()
          .all()
          .filter((n) => n.tag === 'details').length,
        2,
      );
      const alpha = summary()
        .all()
        .find((n) => n.tag === 'details' && n.children[0]?.textContent === 'alpha');
      assert.ok(alpha);
      assert.match(alpha.text(), /Prompt tokens: 18014398509481982; coverage: 2 of 2 records/);
      assert.match(alpha.text(), /Estimated totals: 0.000000000000000002 USD/);
      assert.match(alpha.text(), /Reported totals: Unknown/);
      assert.match(alpha.text(), /Completion tokens: 0; coverage: 1 of 2 records/);
      assert.match(alpha.text(), /Duplicate rows remain included/);
      assert.ok(
        summary()
          .all()
          .some((n) => n.tag === 'summary' && n.textContent === alias),
      );
      assert.equal(
        summary()
          .all()
          .filter((n) => n.tag === 'img').length,
        0,
      );
      assert.doesNotMatch(summary().text(), /human|reference|upstream/);
      assert.equal(calls, 1);
      await show([row('replacement')]);
      assert.doesNotMatch(summary().text(), /alpha|18014398509481982/);
      assert.equal(calls, 2);
      await show([]);
      assert.match(summary().text(), /No model usage on this page/);
      assert.equal(
        summary()
          .all()
          .filter((n) => n.tag === 'details').length,
        0,
      );
      await show([row('private')]);
      app.clear('denied');
      assert.doesNotMatch(root.text(), /private|Current page usage by model/);
      let resolve!: (response: Response) => void;
      const pending = app.connect(
        async () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      );
      app.clear();
      resolve(
        new Response(
          JSON.stringify({
            object: 'list',
            data: [row('late')],
            has_more: false,
            next_cursor: null,
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );
      await pending;
      assert.doesNotMatch(root.text(), /late|Current page usage by model/);
    } finally {
      app.dispose();
    }
    assert.equal(root.text(), '');
  });
}
