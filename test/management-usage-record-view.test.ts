import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { renderUsageRecordDetails } from '../src/management/usage-record-view.ts';
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

function record() {
  return buildUsageRecord({
    principalId: 'human',
    credentialId: 'old-credential',
    policyVersions: [{ id: 'old-policy', version: 'v7' }],
    requestId: 'request',
    attemptId: 'attempt-2',
    occurredAt: 100,
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'upstream',
    selectedCandidateId: 'candidate',
    actualInferenceProviderId: 'provider',
    latencyMs: 23,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: true,
    providerUsage: { prompt_tokens: 0, completion_tokens: 2, total_tokens: 2 },
    estimatedCost: {
      amountDecimal: '0.100000000000000001',
      currency: 'USD',
      priceVersion: 'historical-v9',
    },
    upstreamBilledCost: {
      amountDecimal: '0.100000000000000002',
      currency: 'USD',
      source: 'direct-provider',
    },
  });
}
test('usage list exposes collapsed provenance without another request and clears on loading/denial', async () => {
  const root = new Element();
  const paths: string[] = [];
  let status = 200;
  let release: (() => void) | undefined;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (paths.length > 1)
        await new Promise<void>((r) => {
          release = r;
        });
      return Response.json(
        { object: 'list', data: [record()], has_more: false, next_cursor: null },
        { status },
      );
    },
    { save: () => 'started', dispose() {} },
  );
  await tick();
  const detail = nodes(root).find((n) => n.tag === 'details');
  assert.ok(detail, 'usage record details');
  assert.equal(detail.attributes.open, undefined);
  assert.equal(paths.length, 1);
  assert.match(text(root), /attempt-2/);
  assert.match(text(root), /historical-v9/);
  assert.match(text(root), /old-policy/);
  assert.match(text(root), /Prompt tokens/);
  assert.match(text(root), /0.000000000000000001/);
  click(root, 'Apply filters');
  assert.doesNotMatch(text(root), /attempt-2/);
  status = 403;
  release?.();
  await tick();
  assert.match(text(root), /Access denied/);
  assert.equal(
    nodes(root).some((n) => n.tag === 'details'),
    false,
  );
  app.dispose();
  assert.equal(text(root).trim(), '');
});

function fields(root: Element) {
  const result: Record<string, string | null> = {};
  const all = nodes(root);
  for (const [i, node] of all.entries()) {
    if (node.tag !== 'dt') continue;
    const value = all[i + 1];
    assert.ok(value);
    result[node.textContent ?? ''] = value.textContent;
  }
  return result;
}
test('detail allowlists text, recomputes comparison and retains historical provenance', () => {
  const root = new Element();
  const detail = renderUsageRecordDetails(root, {
    ...record(),
    prompt: 'PRIVATE',
    apiKey: 'PRIVATE',
    costComparison: { status: 'PRIVATE' },
    modelAlias: '<script>unsafe</script>',
  }) as Element;
  assert.doesNotMatch(text(detail), /PRIVATE/);
  assert.equal(
    nodes(detail).some((n) => n.tag === 'script'),
    false,
  );
  const data = fields(detail);
  assert.equal(data['Model alias'], '<script>unsafe</script>');
  assert.equal(data['Prompt tokens'], '0');
  assert.equal(data['Actual inference provider'], 'provider');
  assert.equal(data['Price version'], 'historical-v9');
  assert.equal(data['Comparison currency'], 'USD');
  assert.equal(data['Reported minus estimate'], '0.000000000000000001');
  assert.match(text(detail), /old-credential.*old-policy.*v7/);
});
for (const [status, usage] of [
  ['partial', { status: 'partial', promptTokens: 0, completionTokens: null, totalTokens: null }],
  ['missing', { status: 'missing', promptTokens: null, completionTokens: null, totalTokens: null }],
  ['invalid', { status: 'invalid', promptTokens: null, completionTokens: null, totalTokens: null }],
] as const)
  test(`${status} counters do not invent zero`, () => {
    const detail = renderUsageRecordDetails(new Element(), {
      ...record(),
      usage,
      estimatedCost: null,
      upstreamBilledCost: null,
      policyVersions: [],
      actualInferenceProviderId: null,
      routeKind: 'delegated',
      selectedCandidateId: null,
    }) as Element;
    const data = fields(detail);
    assert.equal(data['Usage status'], status);
    assert.equal(data['Prompt tokens'], status === 'partial' ? '0' : 'Unknown');
    assert.equal(data['Completion tokens'], 'Unknown');
    assert.equal(data['Total tokens'], 'Unknown');
    assert.equal(data['Estimated cost'], 'Unknown');
    assert.equal(data['Price version'], 'Unknown');
    assert.equal(data['Actual inference provider'], 'Unknown');
    assert.match(text(detail), /No policy versions recorded/);
  });
test('currency mismatch does not fabricate comparison or currency conversion', () => {
  const detail = renderUsageRecordDetails(new Element(), {
    ...record(),
    upstreamBilledCost: { amountDecimal: '0', currency: 'EUR', source: 'openrouter' },
  }) as Element;
  const data = fields(detail);
  assert.equal(data['Cost comparison'], 'currency_mismatch');
  assert.equal(data['Reported minus estimate'], 'Unknown');
  assert.equal(data['Comparison currency'], 'Unknown');
  assert.equal(data['Reported cost'], '0 EUR');
});
for (const bad of [
  null,
  {},
  { ...record(), latencyMs: -1 },
  {
    ...record(),
    usage: { status: 'reported', promptTokens: null, completionTokens: null, totalTokens: null },
  },
])
  test('malformed detail fails closed generically', () => {
    const detail = renderUsageRecordDetails(new Element(), bad) as Element;
    assert.equal(text(detail), ' Usage record unavailable.');
    assert.equal(
      nodes(detail).some((n) => n.tag === 'dl'),
      false,
    );
  });
