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
  test('current-page token aggregates: ' + (artifact ? 'artifact' : 'source'), async () => {
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
    const row = (providerUsage?: unknown) =>
      buildUsageRecord({
        principalId: 'human',
        credentialId: 'reference',
        policyVersions: [],
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
        possibleDuplicate: true,
        providerUsage,
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
      const node = root.all().find((n) => n.attrs['aria-label'] === 'Current page cost summary');
      assert.ok(node);
      return node.text();
    };
    try {
      await show([
        row({
          prompt_tokens: Number.MAX_SAFE_INTEGER,
          completion_tokens: 0,
          total_tokens: Number.MAX_SAFE_INTEGER,
        }),
        row({ prompt_tokens: Number.MAX_SAFE_INTEGER }),
        row(),
        row({ total_tokens: -1 }),
      ]);
      assert.match(summary(), /Prompt tokens: 18014398509481982; coverage: 2 of 4 records/);
      assert.match(summary(), /Completion tokens: 0; coverage: 1 of 4 records/);
      assert.match(summary(), /Total tokens: 9007199254740991; coverage: 1 of 4 records/);
      assert.match(
        summary(),
        /Known counters only; missing counters are unknown, not zero or inferred/,
      );
      assert.match(summary(), /Duplicate rows remain included; not reconciled usage/);
      assert.equal(calls, 1);
      const duplicate = row({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 99 });
      await show([duplicate, duplicate]);
      assert.match(summary(), /Prompt tokens: 4; coverage: 2 of 2 records/);
      assert.match(summary(), /Completion tokens: 6; coverage: 2 of 2 records/);
      assert.match(summary(), /Total tokens: 198; coverage: 2 of 2 records/);
      assert.doesNotMatch(summary(), /18014398509481982/);
      await show([row(), row({ total_tokens: -1 })]);
      for (const label of ['Prompt', 'Completion', 'Total'])
        assert.ok(summary().includes(label + ' tokens: Unknown; coverage: 0 of 2 records'));
      await show([row({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })]);
      for (const label of ['Prompt', 'Completion', 'Total'])
        assert.ok(summary().includes(label + ' tokens: 0; coverage: 1 of 1 records'));
      await show([]);
      for (const label of ['Prompt', 'Completion', 'Total'])
        assert.ok(summary().includes(label + ' tokens: Unknown; coverage: 0 of 0 records'));
      await show([duplicate]);
      app.clear();
      assert.doesNotMatch(root.text(), /coverage:|reconciled usage/);
      assert.equal(calls, 6);
    } finally {
      app.dispose();
    }
    assert.doesNotMatch(root.text(), /coverage:/);
  });
}
