import assert from 'node:assert/strict';
import test from 'node:test';
import { explorationCatalog, explorationCombined } from './model-discovery-exploration-fixture.ts';
import {
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

type List = {
  data: Array<{ id: string; created: number; name?: string }>;
  total_count: number;
  links: { next: string | null };
};
async function listed(f: ReturnType<typeof discoveryFixture>, query: string) {
  const response = await f.handler(f.request(query));
  assert.equal(response.status, 200);
  const body = (await response.json()) as List;
  discoveryPrivacy(f);
  return body;
}
const cases: [string, string[]][] = [
  ['', ['unknown', 'tie-first', 'basic', 'zero', 'big', 'tie-second']],
  ['?input_modalities=text', ['unknown', 'tie-first', 'tie-second']],
  ['?input_modalities=image', ['tie-first', 'tie-second']],
  ['?input_modalities=audio', ['big']],
  ['?input_modalities=file', ['big', 'tie-second']],
  ['?q=ATLAS', ['tie-first', 'big', 'tie-second']],
  ['?q=lab%2F', ['tie-first', 'big', 'tie-second']],
  ['?q=BASIC', ['basic']],
  ['?q=Vision', ['tie-first']],
  ['?q=atlas-second', ['tie-second']],
  ['?q=upstream', []],
  ['?q=private-provider', []],
  ['?q=Hidden', []],
  ['?q=NoSuchName', []],
  ['?sort=newest', ['big', 'basic', 'zero', 'tie-first', 'tie-second', 'unknown']],
  ['?sort=context-high-to-low', ['big', 'tie-first', 'tie-second', 'zero', 'unknown', 'basic']],
  ['?q=ATLAS&sort=context-high-to-low', ['big', 'tie-first', 'tie-second']],
  ['?input_modalities=image&q=ATLAS&context=8192&sort=newest', ['tie-first', 'tie-second']],
];
for (const [query, expected] of cases)
  test(`authorized exploration ${query || 'omitted'} keeps exact matching order and counts`, async () => {
    for (const kind of ['managed', 'delegated'] as const) {
      const f = discoveryFixture(explorationCatalog(kind));
      const original = f.models.map((m) => m.alias);
      const body = await listed(f, query);
      assert.deepEqual(
        body.data.map((m) => m.id),
        expected,
      );
      assert.equal(body.total_count, expected.length);
      assert.equal(body.links.next, null);
      assert.deepEqual(
        f.models.map((m) => m.alias),
        original,
      );
      assert.equal(f.reads(), 1);
      assert.equal((f.events[0] as { count: number }).count, expected.length);
    }
  });
test('exploration continuation retains all eight fields and slices after matching stable ordering', async () => {
  const f = discoveryFixture(explorationCatalog());
  const first = await listed(f, explorationCombined);
  assert.deepEqual(
    first.data.map((m) => m.id),
    ['tie-first'],
  );
  assert.equal(first.total_count, 2);
  assert.ok(first.links.next);
  assert.ok(first.links.next.startsWith('/api/v1/models?'));
  const next = new URL(first.links.next, 'https://untrusted.example');
  assert.deepEqual(Object.fromEntries(next.searchParams), {
    offset: '1',
    limit: '1',
    input_modalities: 'image',
    output_modalities: 'text',
    supported_parameters: 'tools',
    context: '8192',
    q: 'ATLAS',
    sort: 'newest',
  });
  const second = await listed(f, next.search);
  assert.deepEqual(
    second.data.map((m) => m.id),
    ['tie-second'],
  );
  assert.equal(second.total_count, 2);
  assert.equal(second.links.next, null);
  const beyond = await listed(
    f,
    '?q=ATLAS&sort=context-high-to-low&offset=9007199254740991&limit=1000',
  );
  assert.deepEqual(beyond.data, []);
  assert.equal(beyond.total_count, 3);
  assert.equal(beyond.links.next, null);
});
test('sorted search-only results above500 stay complete and omitted paging never injects a default', async () => {
  const f = discoveryFixture(
    Array.from({ length: 501 }, (_, i) =>
      discoveryModel(`alias-${i}`, { created: i, inputs: ['image'], name: 'Atlas' }),
    ),
  );
  const body = await listed(f, '?input_modalities=image&q=atlas&sort=newest');
  assert.equal(body.data.length, 501);
  assert.equal(body.total_count, 501);
  assert.equal(body.data[0]?.id, 'alias-500');
  assert.equal(body.data[500]?.id, 'alias-0');
  assert.equal(body.links.next, null);
});
test('search preserves literal punctuation/internal spaces, Unicode lowercase and code-point boundaries', async () => {
  const name = 'CAFÉ Atlas .* [test] + / &';
  const query = 'café atlas .* [test] + / &';
  const f = discoveryFixture([
    discoveryModel('punctuation', { name }),
    discoveryModel('normal', { name: 'Cafe Atlas anything test' }),
  ]);
  const body = await listed(f, `?q=${encodeURIComponent(query)}&sort=newest&limit=1`);
  assert.deepEqual(
    body.data.map((m) => m.id),
    ['punctuation'],
  );
  assert.deepEqual(
    (await listed(f, '?q=Cafe%20Atlas')).data.map((m) => m.id),
    ['normal'],
  );
  for (const term of ['x'.repeat(256), '😀'.repeat(256)]) {
    const boundary = discoveryFixture([discoveryModel(term, { basic: true })]);
    const data = await listed(boundary, `?q=${encodeURIComponent(term)}`);
    assert.equal(data.total_count, 1);
  }
  const explicit = discoveryFixture([discoveryModel('literal-null', { name: 'null' })]);
  assert.equal((await listed(explicit, '?q=null')).total_count, 1);
});
const invalid = [
  '?input_modalities=',
  '?input_modalities=all',
  '?input_modalities=TEXT',
  '?input_modalities=video',
  '?input_modalities=text,unknown',
  '?input_modalities=%20text',
  '?input_modalities=text%20',
  '?input_modalities=image&input_modalities=image',
  '?sort=',
  '?sort=NEWEST',
  '?sort=%20newest',
  '?sort=newest%20',
  '?sort=pricing-low-to-high',
  '?sort=newest&sort=newest',
  '?sort=future-sort',
  '?q=',
  '?q=%20',
  '?q=%20Atlas',
  '?q=Atlas%20',
  '?q=%00Atlas',
  '?q=Atlas%0A',
  '?q=%7FAtlas',
  '?q=%C2%85Atlas',
  '?q=Atlas&q=Atlas',
  `?q=${'x'.repeat(257)}`,
  `?q=${encodeURIComponent('😀'.repeat(257))}`,
];
for (const query of invalid)
  test(`invalid exploration syntax rejects before reading catalog: ${query.slice(0, 70)}`, async () => {
    const f = discoveryFixture(explorationCatalog());
    const r = await f.handler(f.request(query));
    assert.equal(r.status, 400);
    assert.equal(f.reads(), 0);
    assert.equal((f.events[0] as { kind: string }).kind, 'request-denied');
    assert.doesNotMatch(await r.text(), /Atlas|input_modalities|newest|future-sort/u);
    discoveryPrivacy(f);
  });
test('authentication precedes valid and invalid exploration queries on both bases', async () => {
  for (const base of ['/api/v1', '/v1'])
    for (const query of [explorationCombined, '?q=%00Atlas&sort=future-sort']) {
      const f = discoveryFixture(explorationCatalog(), { authenticated: false });
      assert.equal((await f.handler(f.request(query, base))).status, 401);
      assert.equal(f.reads(), 0);
      discoveryPrivacy(f);
    }
});
test('legacy exploration queries reject400 before catalog reads', async () => {
  for (const query of [
    '?q=ATLAS',
    '?sort=newest',
    '?input_modalities=image',
    explorationCombined,
  ]) {
    const f = discoveryFixture(explorationCatalog());
    assert.equal((await f.handler(f.request(query, '/v1'))).status, 400);
    assert.equal(f.reads(), 0);
    discoveryPrivacy(f);
  }
});
test('implicit Deny produces no searchable aliases, order or matching totals', async () => {
  const f = discoveryFixture(explorationCatalog(), { statements: [] });
  const body = await listed(f, explorationCombined);
  assert.deepEqual(body, { object: 'list', data: [], total_count: 0, links: { next: null } });
});
test('catalog and audit failures withhold searched ordered responses and private diagnostics', async () => {
  for (const options of [{ catalogFailure: true }, { auditFailure: true }]) {
    const f = discoveryFixture(explorationCatalog(), options);
    const r = await f.handler(f.request(explorationCombined));
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /Atlas|private|image|newest/u);
    discoveryPrivacy(f);
  }
});
test('hidden/out-of-page malformed entries invalidate the full exploration catalog', async () => {
  const models = explorationCatalog();
  const hidden = models.at(-1);
  assert.ok(hidden);
  Object.assign(hidden, { openRouterMetadata: { private: 'malformed' } });
  const f = discoveryFixture(models);
  assert.equal((await f.handler(f.request(explorationCombined))).status, 503);
  discoveryPrivacy(f);
});
test('audit-time mutation cannot rewrite captured search/input/context/order or response values', async () => {
  const models = explorationCatalog();
  const model = models[1];
  assert.ok(model && model.openRouterMetadata);
  const captured = model.openRouterMetadata;
  const f = discoveryFixture(models, {
    audit: () => {
      Object.assign(captured, { name: 'Changed Private', context_length: 0 });
      Object.assign(captured.architecture, { input_modalities: [] });
      Object.assign(model, { created: 999 });
      models.reverse();
    },
  });
  const body = await listed(f, explorationCombined);
  assert.deepEqual(
    body.data.map((m) => m.id),
    ['tie-first'],
  );
  assert.equal(body.data[0]?.name, 'Atlas Vision');
  assert.equal(body.data[0]?.created, 20);
  assert.equal(body.total_count, 2);
});
test('following exploration continuation reevaluates current model/provider IAM and query fields', async () => {
  const f = discoveryFixture(explorationCatalog());
  const first = await listed(f, explorationCombined);
  assert.ok(first.links.next);
  f.statements.splice(0, f.statements.length, { effect: 'Deny', actions: ['*'], resources: ['*'] });
  const next = await listed(f, new URL(first.links.next, 'https://untrusted.example').search);
  assert.equal(next.total_count, 0);
  assert.deepEqual(next.data, []);
  assert.equal(next.links.next, null);
});

test('invalid exploration audit failure returns a safe503 before catalog access', async () => {
  const f = discoveryFixture(explorationCatalog(), { auditFailure: true });
  const r = await f.handler(f.request('?q=%00Atlas'));
  assert.equal(r.status, 503);
  assert.equal(f.reads(), 0);
  assert.doesNotMatch(await r.text(), /Atlas|private|input_modalities/u);
  discoveryPrivacy(f);
});
test('literal search containing URL separators cannot change continuation destination or paging fields', async () => {
  const term = 'https://other.example/?offset=999&limit=42';
  const f = discoveryFixture([
    discoveryModel('first', { name: term }),
    discoveryModel('second', { name: term }),
  ]);
  const body = await listed(f, `?q=${encodeURIComponent(term)}&sort=newest&limit=1`);
  assert.ok(body.links.next);
  const next = new URL(body.links.next, 'https://trusted-gateway.example');
  assert.equal(next.origin, 'https://trusted-gateway.example');
  assert.equal(next.pathname, '/api/v1/models');
  assert.equal(next.searchParams.get('offset'), '1');
  assert.equal(next.searchParams.get('limit'), '1');
  assert.equal(next.searchParams.get('q'), term);
  assert.equal(next.searchParams.get('sort'), 'newest');
  assert.deepEqual(
    (await listed(f, next.search)).data.map((m) => m.id),
    ['second'],
  );
});
