import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkPrivacy } from './model-benchmark-metadata-fixture.ts';
import {
  benchmarkOrderCatalog,
  benchmarkOrders,
  benchmarkSorts,
  scoredModel,
} from './model-benchmark-order-fixture.ts';
import { discoveryFixture, discoveryModel } from './model-discovery-filters-fixture.ts';

type List = { data: { id: string }[]; total_count: number; links: { next: string | null } };
async function listed(f: ReturnType<typeof discoveryFixture>, query: string) {
  const response = await f.handler(f.request(query));
  assert.equal(response.status, 200);
  benchmarkPrivacy(f);
  return (await response.json()) as List;
}

for (const sort of benchmarkSorts) {
  test(`${sort} orders only IAM-visible captured scores with stable ties and missing last`, async () => {
    for (const kind of ['managed', 'delegated'] as const) {
      const models = benchmarkOrderCatalog(kind);
      const before = structuredClone(models);
      const f = discoveryFixture(models);
      const page = await listed(f, `?sort=${sort}`);
      assert.deepEqual(
        page.data.map((row) => row.id),
        benchmarkOrders[sort],
      );
      assert.equal(page.total_count, 9);
      assert.equal(page.links.next, null);
      assert.deepEqual(models, before);
      assert.equal(f.reads(), 1);
    }
  });

  test(`${sort} retains combined filters and order in fixed relative continuations`, async () => {
    const f = discoveryFixture(benchmarkOrderCatalog());
    const query = new URLSearchParams({
      sort,
      input_modalities: 'text',
      output_modalities: 'text',
      supported_parameters: 'tools',
      context: '8192',
      q: 'Score',
      limit: '2',
    });
    let search = `?${query}`;
    const ids: string[] = [];
    for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
      const page = await listed(f, search);
      assert.equal(page.total_count, 8);
      ids.push(...page.data.map((row) => row.id));
      if (pageNumber === 3) assert.equal(page.links.next, null);
      else {
        assert.ok(page.links.next);
        assert.ok(page.links.next.startsWith('/api/v1/models?'));
        const next = new URL(page.links.next, 'https://gateway.example');
        assert.equal(next.origin, 'https://gateway.example');
        assert.deepEqual(Object.fromEntries(next.searchParams), {
          ...Object.fromEntries(query),
          offset: String((pageNumber + 1) * 2),
        });
        search = next.search;
      }
    }
    assert.deepEqual(
      ids,
      benchmarkOrders[sort].filter((id) => id !== 'basic'),
    );
  });

  test(`${sort} compares finite extremes, negative scores and zero without a missing-value sentinel`, async () => {
    const values = [null, -Number.MAX_VALUE, 0, Number.MAX_VALUE, -1, Number.MIN_VALUE] as const;
    const f = discoveryFixture(
      values.map((score, index) =>
        scoredModel(`score-${index}`, [score, score, score], score === null ? [] : [score]),
      ),
    );
    const page = await listed(f, `?sort=${sort}`);
    assert.deepEqual(
      page.data.map((row) => row.id),
      ['score-3', 'score-5', 'score-2', 'score-4', 'score-1', 'score-0'],
    );
  });
}

test('benchmark ordering keeps omitted catalog order and authenticates before query validation', async () => {
  const f = discoveryFixture(benchmarkOrderCatalog());
  assert.deepEqual(
    (await listed(f, '')).data.map((row) => row.id),
    [
      'unknown',
      'tie-first',
      'basic',
      'zero',
      'intelligence',
      'coding',
      'agentic',
      'tie-second',
      'missing-analysis',
    ],
  );
  for (const sort of [...benchmarkSorts, 'UNKNOWN']) {
    const denied = discoveryFixture(benchmarkOrderCatalog(), { authenticated: false });
    assert.equal((await denied.handler(denied.request(`?sort=${sort}`))).status, 401);
    assert.equal(denied.reads(), 0);
    benchmarkPrivacy(denied);
  }
});

test('all missing benchmark shapes retain catalog order for every selected score', async () => {
  for (const sort of benchmarkSorts) {
    const f = discoveryFixture([
      discoveryModel('absent'),
      discoveryModel('basic', { basic: true }),
      scoredModel('null', [null, null, null]),
      scoredModel('no-analysis', undefined),
    ]);
    const page = await listed(f, `?sort=${sort}`);
    assert.deepEqual(
      page.data.map((row) => row.id),
      ['absent', 'basic', 'null', 'no-analysis'],
    );
  }
});

test('invalid and legacy benchmark sort queries reject before catalog reads', async () => {
  for (const query of [
    '?sort=INTELLIGENCE-HIGH-TO-LOW',
    '?sort=%20coding-high-to-low',
    '?sort=agentic-high-to-low%20',
    '?sort=design-arena-elo-high-to-low&sort=newest',
  ]) {
    const f = discoveryFixture(benchmarkOrderCatalog());
    const response = await f.handler(f.request(query));
    assert.equal(response.status, 400);
    assert.equal(f.reads(), 0);
    assert.doesNotMatch(await response.text(), /high-to-low|benchmark-private/);
    benchmarkPrivacy(f);
  }
  for (const sort of benchmarkSorts) {
    const f = discoveryFixture(benchmarkOrderCatalog());
    assert.equal((await f.handler(f.request(`?sort=${sort}`, '/v1'))).status, 400);
    assert.equal(f.reads(), 0);
  }
});

test('benchmark pages reload current IAM and never expose denied score positions or counts', async () => {
  const f = discoveryFixture(benchmarkOrderCatalog());
  const first = await listed(f, '?sort=intelligence-high-to-low&limit=1');
  assert.equal(first.data[0]?.id, 'intelligence');
  assert.ok(first.links.next);
  f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
  const next = await listed(f, new URL(first.links.next, 'https://gateway.example').search);
  assert.deepEqual(next, { object: 'list', data: [], total_count: 0, links: { next: null } });
  const implicit = discoveryFixture(benchmarkOrderCatalog(), { statements: [] });
  assert.deepEqual((await listed(implicit, '?sort=agentic-high-to-low')).data, []);
});

test('benchmark listing fails closed for catalog/audit faults and malformed hidden scores', async () => {
  for (const options of [{ catalogFailure: true }, { auditFailure: true }]) {
    const f = discoveryFixture(benchmarkOrderCatalog(), options);
    const response = await f.handler(f.request('?sort=coding-high-to-low&limit=1'));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /coding|benchmark|private/);
    benchmarkPrivacy(f);
  }
  const models = benchmarkOrderCatalog();
  const hidden = models.at(-1);
  assert.ok(hidden?.openRouterMetadata?.benchmarks?.artificial_analysis);
  Object.assign(hidden.openRouterMetadata.benchmarks.artificial_analysis, {
    intelligence_index: NaN,
  });
  const f = discoveryFixture(models);
  const response = await f.handler(f.request('?sort=intelligence-high-to-low&limit=1'));
  assert.equal(response.status, 503);
  benchmarkPrivacy(f);
});

test('audit-time score and catalog mutation cannot reorder or rewrite the captured response', async () => {
  const models = benchmarkOrderCatalog();
  const first = models[1];
  assert.ok(first?.openRouterMetadata?.benchmarks?.artificial_analysis);
  const f = discoveryFixture(models, {
    audit: () => {
      Object.assign(first.openRouterMetadata?.benchmarks?.artificial_analysis ?? {}, {
        intelligence_index: 9999,
      });
      models.reverse();
    },
  });
  const page = await listed(f, '?sort=intelligence-high-to-low');
  assert.deepEqual(
    page.data.map((row) => row.id),
    benchmarkOrders['intelligence-high-to-low'],
  );
  const captured = page.data.find((row) => row.id === 'tie-first') as unknown as {
    benchmarks: { artificial_analysis: { intelligence_index: number } };
  };
  assert.equal(captured.benchmarks.artificial_analysis.intelligence_index, 3);
});
