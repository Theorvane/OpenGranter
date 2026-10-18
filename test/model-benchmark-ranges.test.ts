import assert from 'node:assert/strict';
import test from 'node:test';
import { scoredModel } from './model-benchmark-order-fixture.ts';
import { allRanges, indices, rangeCatalog } from './model-benchmark-ranges-fixture.ts';
import { discoveryFixture, discoveryPrivacy } from './model-discovery-filters-fixture.ts';

type Page = { data: { id: string }[]; total_count: number; links: { next: string | null } };
async function listed(f: ReturnType<typeof discoveryFixture>, query: string): Promise<Page> {
  const response = await f.handler(f.request(query));
  assert.equal(response.status, 200);
  discoveryPrivacy(f);
  assert.doesNotMatch(JSON.stringify(f.events), /min_|max_|_index|benchmarkRanges/u);
  return (await response.json()) as Page;
}
const expected = {
  intelligence_index: ['middle', 'partial', 'tie'],
  coding_index: ['low', 'middle', 'tie'],
  agentic_index: ['middle', 'partial', 'tie'],
};
for (const index of indices) {
  test(`${index} bounds are inclusive on both route kinds and exclude unknown scores`, async () => {
    for (const kind of ['managed', 'delegated'] as const) {
      const f = discoveryFixture(rangeCatalog(kind));
      const original = structuredClone(f.models);
      const page = await listed(f, `?min_${index}=5&max_${index}=7`);
      assert.deepEqual(
        page.data.map((row) => row.id),
        expected[index],
      );
      assert.equal(page.total_count, expected[index].length);
      assert.deepEqual(f.models, original);
    }
  });
  test(`${index} one-sided and equal zero bounds distinguish negative, zero and unknown`, async () => {
    const f = discoveryFixture(rangeCatalog());
    assert.deepEqual(
      (await listed(f, `?max_${index}=0`)).data.map((row) => row.id),
      ['zero', 'negative'],
    );
    assert.deepEqual(
      (await listed(f, `?min_${index}=0&max_${index}=0`)).data.map((row) => row.id),
      ['zero'],
    );
    const above = await listed(f, `?min_${index}=5`);
    assert.ok(above.data.some((row) => row.id === 'middle'));
    assert.ok(
      above.data.every((row) => !['zero', 'negative', 'unknown', 'basic'].includes(row.id)),
    );
  });
}
test('all six bounds compose with existing filters, sorting and relative continuations', async () => {
  const f = discoveryFixture(rangeCatalog());
  const params = new URLSearchParams({
    ...allRanges,
    q: 'Score',
    input_modalities: 'text',
    output_modalities: 'text',
    supported_parameters: 'tools',
    context: '8192',
    sort: 'pricing-high-to-low',
    limit: '1',
  });
  const first = await listed(f, `?${params}`);
  assert.deepEqual(
    first.data.map((row) => row.id),
    ['middle'],
  );
  assert.equal(first.total_count, 2);
  assert.ok(first.links.next);
  assert.ok(first.links.next.startsWith('/api/v1/models?'));
  const next = new URL(first.links.next, 'https://gateway.example');
  assert.equal(next.origin, 'https://gateway.example');
  assert.deepEqual(Object.fromEntries(next.searchParams), {
    ...Object.fromEntries(params),
    offset: '1',
  });
  const second = await listed(f, next.search);
  assert.deepEqual(
    second.data.map((row) => row.id),
    ['tie'],
  );
  assert.equal(second.links.next, null);
});
test('numeric score semantics retain fractions, scientific notation, extreme finite values and canonical pages', async () => {
  const f = discoveryFixture([
    scoredModel('half', [0.5, 0.5, 0.5]),
    scoredModel('fraction', [0.75, 0.75, 0.75]),
    scoredModel('large', [1e308, 1e308, 1e308]),
  ]);
  const first = await listed(f, '?min_coding_index=5e-1&max_coding_index=7.5e-1&limit=1');
  assert.equal(first.data[0]?.id, 'half');
  assert.ok(first.links.next);
  const next = new URL(first.links.next, 'https://gateway.example');
  assert.equal(next.searchParams.get('min_coding_index'), '0.5');
  assert.equal(next.searchParams.get('max_coding_index'), '0.75');
  assert.equal((await listed(f, next.search)).data[0]?.id, 'fraction');
  assert.equal((await listed(f, '?min_coding_index=1e308')).data[0]?.id, 'large');
  assert.equal((await listed(f, `?min_coding_index=1${'0'.repeat(127)}`)).data[0]?.id, 'large');
  assert.equal((await listed(f, '?max_coding_index=1e-999')).total_count, 0);
});
test('range syntax and reversed pairs reject before catalog access after authentication', async () => {
  for (const index of indices) {
    for (const side of ['min', 'max']) {
      const name = `${side}_${index}`;
      for (const value of [
        '',
        'null',
        'NaN',
        'Infinity',
        '-1',
        '-0',
        '+1',
        ' 5',
        '5 ',
        '.5',
        '01',
        '1.',
        '1e309',
        '1'.repeat(129),
      ]) {
        const f = discoveryFixture(rangeCatalog());
        const response = await f.handler(f.request(`?${new URLSearchParams({ [name]: value })}`));
        assert.equal(response.status, 400, `${name}=${value}`);
        assert.equal(f.reads(), 0);
        discoveryPrivacy(f);
      }
      const duplicate = discoveryFixture(rangeCatalog());
      assert.equal(
        (await duplicate.handler(duplicate.request(`?${name}=1&${name}=1`))).status,
        400,
      );
      assert.equal(duplicate.reads(), 0);
    }
    const reversed = discoveryFixture(rangeCatalog());
    assert.equal(
      (await reversed.handler(reversed.request(`?min_${index}=6&max_${index}=5`))).status,
      400,
    );
    assert.equal(reversed.reads(), 0);
  }
  const unauthenticated = discoveryFixture(rangeCatalog(), { authenticated: false });
  assert.equal(
    (await unauthenticated.handler(unauthenticated.request('?min_coding_index=bad'))).status,
    401,
  );
  assert.equal(unauthenticated.reads(), 0);
  const legacy = discoveryFixture(rangeCatalog());
  assert.equal((await legacy.handler(legacy.request('?min_coding_index=0', '/v1'))).status, 400);
  assert.equal(legacy.reads(), 0);
});
test('range pages reevaluate current IAM and do not expose inaccessible matching counts', async () => {
  const f = discoveryFixture(rangeCatalog());
  const first = await listed(f, `?${new URLSearchParams({ ...allRanges, limit: '1' })}`);
  assert.ok(first.links.next);
  f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
  assert.deepEqual(await listed(f, new URL(first.links.next, 'https://gateway.example').search), {
    object: 'list',
    data: [],
    total_count: 0,
    links: { next: null },
  });
  const implicit = discoveryFixture(rangeCatalog(), { statements: [] });
  assert.equal((await listed(implicit, '?min_intelligence_index=0')).total_count, 0);
});
test('hidden malformed scores and required failures withhold range results privately', async () => {
  const models = rangeCatalog();
  const disabled = models.at(-1);
  assert.ok(disabled?.openRouterMetadata?.benchmarks?.artificial_analysis);
  Object.assign(disabled.openRouterMetadata.benchmarks.artificial_analysis, {
    coding_index: Infinity,
  });
  for (const f of [
    discoveryFixture(models),
    discoveryFixture(rangeCatalog(), { catalogFailure: true }),
    discoveryFixture(rangeCatalog(), { auditFailure: true }),
  ]) {
    const response = await f.handler(f.request('?min_coding_index=0&limit=1'));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private|coding|Infinity|benchmark/u);
    discoveryPrivacy(f);
  }
});
test('audit mutation cannot change captured range results and omitted ranges preserve order', async () => {
  const models = rangeCatalog();
  const middle = models[2];
  assert.ok(middle?.openRouterMetadata?.benchmarks?.artificial_analysis);
  const f = discoveryFixture(models, {
    audit: () => {
      Object.assign(middle.openRouterMetadata?.benchmarks?.artificial_analysis ?? {}, {
        coding_index: -100,
      });
      models.reverse();
    },
  });
  const page = await listed(f, `?${new URLSearchParams(allRanges)}`);
  assert.deepEqual(
    page.data.map((row) => row.id),
    ['middle', 'tie'],
  );
  const unfiltered = await listed(discoveryFixture(rangeCatalog()), '');
  assert.deepEqual(
    unfiltered.data.map((row) => row.id),
    [
      'unknown',
      'low',
      'middle',
      'high',
      'zero',
      'negative',
      'partial',
      'tie',
      'missing-analysis',
      'basic',
    ],
  );
});
