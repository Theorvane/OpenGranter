import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryFixture, discoveryModel } from './model-discovery-filters-fixture.ts';
import {
  pricedModel,
  priceOrderCatalog,
  priceOrderPrivacy,
  priceOrders,
  priceSorts,
} from './model-price-order-fixture.ts';

type List = {
  data: { id: string; pricing?: { prompt: string; completion: string } }[];
  total_count: number;
  links: { next: string | null };
};
async function listed(f: ReturnType<typeof discoveryFixture>, query: string) {
  const response = await f.handler(f.request(query));
  assert.equal(response.status, 200);
  priceOrderPrivacy(f);
  return (await response.json()) as List;
}
for (const sort of priceSorts) {
  test(`${sort} compares exact base means with stable ties and missing last on both route kinds`, async () => {
    for (const kind of ['managed', 'delegated'] as const) {
      const models = priceOrderCatalog(kind);
      const original = structuredClone(models);
      const f = discoveryFixture(models);
      const page = await listed(f, `?sort=${sort}`);
      assert.deepEqual(
        page.data.map((row) => row.id),
        priceOrders[sort],
      );
      assert.equal(page.total_count, 9);
      assert.equal(page.links.next, null);
      assert.deepEqual(models, original);
    }
  });

  test(`${sort} preserves all combined filters and exact order across relative pages`, async () => {
    const f = discoveryFixture(priceOrderCatalog());
    const params = new URLSearchParams({
      sort,
      limit: '2',
      q: 'Price',
      input_modalities: 'text',
      output_modalities: 'text',
      supported_parameters: 'tools',
      context: '8192',
    });
    let search = `?${params}`;
    const ids: string[] = [];
    for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
      const page = await listed(f, search);
      assert.equal(page.total_count, 8);
      ids.push(...page.data.map((row) => row.id));
      if (pageNumber === 3) assert.equal(page.links.next, null);
      else {
        assert.ok(page.links.next);
        const next = new URL(page.links.next, 'https://gateway.example');
        assert.equal(next.origin, 'https://gateway.example');
        assert.equal(next.pathname, '/api/v1/models');
        assert.deepEqual(Object.fromEntries(next.searchParams), {
          ...Object.fromEntries(params),
          offset: String((pageNumber + 1) * 2),
        });
        search = next.search;
      }
    }
    assert.deepEqual(
      ids,
      priceOrders[sort].filter((id) => id !== 'basic'),
    );
  });

  test(`${sort} matches an independent bounded integer-unit oracle`, async () => {
    const rows = Array.from({ length: 64 }, (_, index) => {
      const group = index % 32;
      const prompt = (group * 37) % 997;
      const completion = (group * 83) % 991;
      const decimal = (units: number) => {
        const digits = String(units).padStart(7, '0');
        return `${digits.slice(0, -6)}.${digits.slice(-6)}`;
      };
      return {
        model: pricedModel(
          `oracle-${index}`,
          index % 2 ? decimal(prompt) : `${prompt}e-6`,
          `${completion * 10}e-7`,
        ),
        total: BigInt(prompt) + BigInt(completion),
      };
    });
    const expected = rows
      .slice()
      .sort((left, right) => {
        const order = left.total === right.total ? 0 : left.total < right.total ? -1 : 1;
        return sort === 'pricing-low-to-high' ? order : -order;
      })
      .map((row) => row.model.alias);
    const f = discoveryFixture(rows.map((row) => row.model));
    assert.deepEqual(
      (await listed(f, `?sort=${sort}`)).data.map((row) => row.id),
      expected,
    );
  });
}

test('exact sums retain tiny addends, huge exponent gaps, carry chains and overflowing finite components', async () => {
  const exponent = '9'.repeat(100);
  const nextExponent = `1${'0'.repeat(100)}`;
  const models = [
    pricedModel('sum-high', '1e308', '1e308'),
    pricedModel('sum-middle', '9e307', '9e307'),
    pricedModel('sparse-two', '1', `2e-${exponent}`),
    pricedModel('carry', `0.${'9'.repeat(126)}`, '1e-126'),
    pricedModel('free', '0', '0'),
    pricedModel('exponent-zero', `0e${exponent}`, '0'),
    pricedModel('sparse-one', '1', `1e-${exponent}`),
    pricedModel('tiny', `1e-${exponent}`, '0'),
    pricedModel('one', '1', '0'),
    pricedModel('sparse-equivalent', '1', `10e-${nextExponent}`),
    pricedModel('underflow', '1e-4000', '0'),
    pricedModel('sum-lower', '1e308', '0'),
  ];
  const expected = {
    'pricing-low-to-high': [
      'free',
      'exponent-zero',
      'tiny',
      'underflow',
      'carry',
      'one',
      'sparse-one',
      'sparse-equivalent',
      'sparse-two',
      'sum-lower',
      'sum-middle',
      'sum-high',
    ],
    'pricing-high-to-low': [
      'sum-high',
      'sum-middle',
      'sum-lower',
      'sparse-two',
      'sparse-one',
      'sparse-equivalent',
      'carry',
      'one',
      'underflow',
      'tiny',
      'free',
      'exponent-zero',
    ],
  };
  for (const sort of priceSorts) {
    const f = discoveryFixture(models);
    assert.deepEqual(
      (await listed(f, `?sort=${sort}`)).data.map((row) => row.id),
      expected[sort],
    );
  }
});

test('unpriced aliases preserve their relative order after known zero in either direction', async () => {
  for (const sort of priceSorts) {
    const f = discoveryFixture([
      discoveryModel('missing-first', { basic: true }),
      pricedModel('free', '0', '0'),
      discoveryModel('missing-second', { basic: true }),
    ]);
    assert.deepEqual(
      (await listed(f, `?sort=${sort}`)).data.map((row) => row.id),
      ['free', 'missing-first', 'missing-second'],
    );
  }
});

test('price queries authenticate first, reject malformed/legacy syntax early and retain omitted order', async () => {
  for (const sort of priceSorts) {
    const unauthenticated = discoveryFixture(priceOrderCatalog(), { authenticated: false });
    assert.equal(
      (await unauthenticated.handler(unauthenticated.request(`?sort=${sort}`))).status,
      401,
    );
    assert.equal(unauthenticated.reads(), 0);
    const legacy = discoveryFixture(priceOrderCatalog());
    assert.equal((await legacy.handler(legacy.request(`?sort=${sort}`, '/v1'))).status, 400);
    assert.equal(legacy.reads(), 0);
  }
  for (const query of [
    '?sort=PRICING-LOW-TO-HIGH',
    '?sort=%20pricing-high-to-low',
    '?sort=pricing-low-to-high%20',
    '?sort=pricing-low-to-high&sort=pricing-low-to-high',
  ]) {
    const f = discoveryFixture(priceOrderCatalog());
    assert.equal((await f.handler(f.request(query))).status, 400);
    assert.equal(f.reads(), 0);
    priceOrderPrivacy(f);
  }
  const f = discoveryFixture(priceOrderCatalog());
  assert.deepEqual(
    (await listed(f, '')).data.map((row) => row.id),
    [
      'basic',
      'precise-high',
      'free',
      'high-output',
      'balanced',
      'tie-first',
      'high-input',
      'tie-second',
      'precise-low',
    ],
  );
});

test('price pages recheck current IAM and withhold inaccessible order and counts', async () => {
  const f = discoveryFixture(priceOrderCatalog());
  const first = await listed(f, '?sort=pricing-low-to-high&limit=1');
  assert.equal(first.data[0]?.id, 'free');
  assert.ok(first.links.next);
  f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
  const second = await listed(f, new URL(first.links.next, 'https://gateway.example').search);
  assert.deepEqual(second, { object: 'list', data: [], total_count: 0, links: { next: null } });
  const implicit = discoveryFixture(priceOrderCatalog(), { statements: [] });
  assert.equal((await listed(implicit, '?sort=pricing-high-to-low')).total_count, 0);
});

test('malformed hidden prices and required catalog/audit failures withhold private results', async () => {
  for (const price of ['-1', '1e309', 'private-price']) {
    const models = priceOrderCatalog();
    const hidden = models.at(-1);
    assert.ok(hidden?.openRouterMetadata);
    Object.assign(hidden.openRouterMetadata.pricing, { prompt: price });
    const f = discoveryFixture(models);
    const response = await f.handler(f.request('?sort=pricing-low-to-high&limit=1'));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /pricing|private|1e309/);
    priceOrderPrivacy(f);
  }
  for (const options of [{ catalogFailure: true }, { auditFailure: true }]) {
    const f = discoveryFixture(priceOrderCatalog(), options);
    assert.equal((await f.handler(f.request('?sort=pricing-high-to-low'))).status, 503);
    priceOrderPrivacy(f);
  }
});

test('audit-time price/catalog mutation cannot change captured order or original price spelling', async () => {
  const models = priceOrderCatalog();
  const precise = models[1];
  assert.ok(precise?.openRouterMetadata);
  const f = discoveryFixture(models, {
    audit: () => {
      Object.assign(precise.openRouterMetadata?.pricing ?? {}, { prompt: '0', completion: '0' });
      models.reverse();
    },
  });
  const page = await listed(f, '?sort=pricing-low-to-high');
  assert.deepEqual(
    page.data.map((row) => row.id),
    priceOrders['pricing-low-to-high'],
  );
  assert.equal(
    page.data.find((row) => row.id === 'precise-high')?.pricing?.prompt,
    '1.0000000000000000000000000000002',
  );
});
