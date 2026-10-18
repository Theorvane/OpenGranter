import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryFixture } from './model-discovery-filters-fixture.ts';
import { pricedModel } from './model-price-order-fixture.ts';
import {
  priceBoundNames,
  priceBounds,
  priceRangeCatalog,
  priceRangePrivacy,
} from './model-price-ranges-fixture.ts';

type Page = {
  data: { id: string; pricing?: { prompt: string; completion: string } }[];
  total_count: number;
  links: { next: string | null };
};
async function listed(f: ReturnType<typeof discoveryFixture>, query: string): Promise<Page> {
  const response = await f.handler(f.request(query));
  assert.equal(response.status, 200);
  priceRangePrivacy(f);
  return (await response.json()) as Page;
}
for (const kind of ['managed', 'delegated'] as const) {
  test(`${kind} four price bounds use inclusive base USD per million values`, async () => {
    const f = discoveryFixture(priceRangeCatalog(kind));
    const original = structuredClone(f.models);
    const page = await listed(f, `?${new URLSearchParams(priceBounds)}`);
    assert.deepEqual(
      page.data.map((row) => row.id),
      ['middle', 'tie'],
    );
    assert.equal(page.total_count, 2);
    assert.deepEqual(f.models, original);
  });
}
for (const [suffix, equal] of [
  ['price', '3'],
  ['output_price', '4'],
]) {
  test(`${suffix} equal and one-sided bounds retain zero and exclude missing prices`, async () => {
    const f = discoveryFixture(priceRangeCatalog());
    assert.deepEqual(
      (await listed(f, `?min_${suffix}=${equal}&max_${suffix}=${equal}`)).data.map((row) => row.id),
      ['middle', 'tie'],
    );
    assert.deepEqual(
      (await listed(f, `?max_${suffix}=0`)).data.map((row) => row.id),
      ['free'],
    );
    assert.deepEqual(
      (await listed(f, `?min_${suffix}=${equal}`)).data.map((row) => row.id),
      ['middle', 'tie', 'high'],
    );
    assert.equal((await listed(f, `?min_${suffix}=0`)).total_count, 5);
  });
}
test('price comparisons preserve precision, exact unit conversion, underflow and huge exponent gaps', async () => {
  const extreme = `1e-${'9'.repeat(100)}`;
  const f = discoveryFixture([
    pricedModel('zero', '0', '0'),
    pricedModel('tiny', extreme, extreme),
    pricedModel('low', '1.0000000000000000000000001e-6', '1.0000000000000000000000001e-6'),
    pricedModel('high', '1.0000000000000000000000002e-6', '1.0000000000000000000000002e-6'),
    pricedModel('large', '1e302', '1e302'),
    pricedModel('above', '1e308', '1e308'),
  ]);
  for (const suffix of ['price', 'output_price']) {
    const exactTinyBound = `1e-${BigInt('9'.repeat(100)) - 6n}`;
    assert.deepEqual(
      (
        await listed(f, `?min_${suffix}=${exactTinyBound}&max_${suffix}=${exactTinyBound}`)
      ).data.map((row) => row.id),
      ['tiny'],
    );
    assert.deepEqual(
      (
        await listed(
          f,
          `?min_${suffix}=1.0000000000000000000000002&max_${suffix}=1.0000000000000000000000002`,
        )
      ).data.map((row) => row.id),
      ['high'],
    );
    assert.deepEqual(
      (await listed(f, `?max_${suffix}=0e%2B${'9'.repeat(100)}`)).data.map((row) => row.id),
      ['zero'],
    );
    assert.deepEqual(
      (await listed(f, `?max_${suffix}=1e-999`)).data.map((row) => row.id),
      ['zero', 'tiny'],
    );
    assert.deepEqual(
      (await listed(f, `?min_${suffix}=1e308&max_${suffix}=1e308`)).data.map((row) => row.id),
      ['large'],
    );
    assert.deepEqual(
      (await listed(f, `?min_${suffix}=1e308`)).data.map((row) => row.id),
      ['large', 'above'],
    );
  }
});
test('bounded integer oracle independently checks both exact price filters', async () => {
  const units = Array.from({ length: 64 }, (_, i) => (i * 7919) % 10001);
  const f = discoveryFixture(
    units.map((value, i) => pricedModel(`m${i}`, `${value}e-8`, `${10000 - value}e-8`)),
  );
  const page = await listed(
    f,
    '?min_price=15.25&max_price=80&min_output_price=20&max_output_price=70.5',
  );
  assert.deepEqual(
    page.data.map((row) => row.id),
    units.flatMap((value, i) =>
      value >= 1525 && value <= 8000 && 10000 - value >= 2000 && 10000 - value <= 7050
        ? [`m${i}`]
        : [],
    ),
  );
});
test('all filters sort before paging and preserve exact bound spellings in relative continuations', async () => {
  const f = discoveryFixture(priceRangeCatalog());
  for (const model of f.models)
    if (model.openRouterMetadata)
      Object.assign(model.openRouterMetadata, {
        benchmarks: {
          design_arena: [],
          artificial_analysis: { intelligence_index: 5, coding_index: 5, agentic_index: 5 },
        },
      });
  const params = new URLSearchParams({
    ...priceBounds,
    min_price: '2.00e+0',
    min_coding_index: '5',
    max_coding_index: '5',
    q: 'Price',
    input_modalities: 'text',
    output_modalities: 'text',
    supported_parameters: 'tools',
    context: '8192',
    sort: 'pricing-high-to-low',
    limit: '1',
  });
  const first = await listed(f, `?${params}`);
  assert.equal(first.data[0]?.id, 'middle');
  assert.equal(first.total_count, 2);
  assert.ok(first.links.next);
  assert.ok(first.links.next.startsWith('/api/v1/models?'));
  const next = new URL(first.links.next, 'https://gateway.example');
  assert.deepEqual(Object.fromEntries(next.searchParams), {
    ...Object.fromEntries(params),
    offset: '1',
  });
  assert.equal((await listed(f, next.search)).data[0]?.id, 'tie');
});
test('invalid and exactly reversed bounds reject before catalog access after authentication', async () => {
  for (const name of priceBoundNames) {
    for (const value of [
      '',
      'null',
      'NaN',
      'Infinity',
      '-1',
      '-0',
      '+1',
      ' 1',
      '1 ',
      '.5',
      '01',
      '1.',
      '1e309',
      '1'.repeat(129),
    ]) {
      const f = discoveryFixture(priceRangeCatalog());
      assert.equal(
        (await f.handler(f.request(`?${new URLSearchParams({ [name]: value })}`))).status,
        400,
        `${name}=${value}`,
      );
      assert.equal(f.reads(), 0);
      priceRangePrivacy(f);
    }
    const f = discoveryFixture(priceRangeCatalog());
    assert.equal((await f.handler(f.request(`?${name}=0&${name}=0`))).status, 400);
    assert.equal(f.reads(), 0);
  }
  for (const suffix of ['price', 'output_price']) {
    for (const [min, max] of [
      ['2', '1'],
      ['1.0000000000000000000000002', '1.0000000000000000000000001'],
      ['1e-998', '1e-999'],
    ]) {
      const f = discoveryFixture(priceRangeCatalog());
      assert.equal(
        (await f.handler(f.request(`?min_${suffix}=${min}&max_${suffix}=${max}`))).status,
        400,
      );
      assert.equal(f.reads(), 0);
    }
  }
  const unauthenticated = discoveryFixture(priceRangeCatalog(), { authenticated: false });
  assert.equal(
    (await unauthenticated.handler(unauthenticated.request('?min_price=bad'))).status,
    401,
  );
  assert.equal(unauthenticated.reads(), 0);
  const legacy = discoveryFixture(priceRangeCatalog());
  assert.equal((await legacy.handler(legacy.request('?min_price=0', '/v1'))).status, 400);
  assert.equal(legacy.reads(), 0);
  const count = discoveryFixture(priceRangeCatalog());
  assert.equal(
    (
      await count.handler(
        new Request('http://gateway.example/api/v1/models/count?min_price=0', {
          headers: { authorization: 'Bearer fixture' },
        }),
      )
    ).status,
    400,
  );
  assert.equal(count.reads(), 0);
});
test('price pages reevaluate current model/provider IAM and current metadata', async () => {
  for (const resource of ['model:tie', 'provider:provider']) {
    const f = discoveryFixture(priceRangeCatalog());
    const first = await listed(f, `?${new URLSearchParams({ ...priceBounds, limit: '1' })}`);
    assert.ok(first.links.next);
    f.statements.push({ effect: 'Deny', actions: ['*'], resources: [resource] });
    const page = await listed(f, new URL(first.links.next, 'https://gateway.example').search);
    assert.deepEqual(page.data, []);
    assert.equal(page.total_count, resource.startsWith('model:') ? 1 : 0);
  }
  const implicit = discoveryFixture(priceRangeCatalog(), { statements: [] });
  assert.equal((await listed(implicit, '?min_price=0')).total_count, 0);
  const f = discoveryFixture(priceRangeCatalog());
  const first = await listed(f, `?${new URLSearchParams({ ...priceBounds, limit: '1' })}`);
  assert.ok(first.links.next);
  Object.assign(f.models[3]?.openRouterMetadata?.pricing ?? {}, { prompt: '9' });
  assert.equal(
    (await listed(f, new URL(first.links.next, 'https://gateway.example').search)).total_count,
    1,
  );
});
test('full hidden catalog validation and required failures withhold private price results', async () => {
  const models = priceRangeCatalog();
  Object.assign(models.at(-1)?.openRouterMetadata?.pricing ?? {}, { prompt: 'private-invalid' });
  for (const f of [
    discoveryFixture(models),
    discoveryFixture(priceRangeCatalog(), { catalogFailure: true }),
    discoveryFixture(priceRangeCatalog(), { auditFailure: true }),
  ]) {
    const response = await f.handler(f.request('?min_price=0&limit=1'));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private|pricing|priceRange|3e-6/u);
    priceRangePrivacy(f);
  }
});
test('audit-time mutation cannot alter captured prices and omitted bounds preserve existing listing', async () => {
  const models = priceRangeCatalog();
  const f = discoveryFixture(models, {
    audit: () => {
      Object.assign(models[2]?.openRouterMetadata?.pricing ?? {}, { prompt: '9' });
      models.reverse();
    },
  });
  const page = await listed(f, `?${new URLSearchParams(priceBounds)}`);
  assert.deepEqual(
    page.data.map((row) => row.id),
    ['middle', 'tie'],
  );
  assert.equal(page.data[0]?.pricing?.prompt, '3e-6');
  assert.deepEqual(
    (await listed(discoveryFixture(priceRangeCatalog()), '')).data.map((row) => row.id),
    ['free', 'low', 'middle', 'tie', 'high', 'basic'],
  );
});
