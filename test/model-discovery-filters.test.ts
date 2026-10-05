import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoveryAllow,
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

type List = {
  data: Array<{ id: string; context_length?: number | null; supported_parameters?: string[] }>;
  total_count: number;
  links: { next: string | null };
};
for (const [query, expected] of [
  ['', ['small', 'multi', 'unknown', 'large', 'image', 'basic']],
  ['?output_modalities=all', ['small', 'multi', 'unknown', 'large', 'image', 'basic']],
  ['?output_modalities=text', ['small', 'multi', 'unknown', 'large']],
  ['?output_modalities=image', ['multi', 'large', 'image']],
  ['?supported_parameters=tools', ['multi', 'unknown', 'large', 'image']],
  ['?supported_parameters=temperature', ['small', 'multi']],
  ['?supported_parameters=unknown_parameter', []],
  ['?context=1', ['small', 'multi', 'large', 'image']],
  ['?context=8192', ['multi', 'large', 'image']],
  ['?context=16384', ['large']],
  ['?context=9007199254740991', []],
  ['?output_modalities=text&supported_parameters=tools&context=8192', ['multi', 'large']],
  ['?output_modalities=all&context=8192', ['multi', 'large', 'image']],
  ['?output_modalities=image&supported_parameters=temperature&context=16384', []],
] as const)
  test(`discovery selects authorized captured metadata for ${query || 'omitted filters'}`, async () => {
    const f = discoveryFixture();
    const r = await f.handler(f.request(query));
    assert.equal(r.status, 200);
    const body = (await r.json()) as List;
    assert.deepEqual(
      body.data.map((m) => m.id),
      expected,
    );
    assert.equal(body.total_count, expected.length);
    assert.equal(body.links.next, null);
    assert.equal(f.reads(), 1);
    assert.equal((f.events[0] as { count: number }).count, expected.length);
    discoveryPrivacy(f);
  });
for (const output of [
  'text',
  'image',
  'embeddings',
  'audio',
  'video',
  'rerank',
  'decisions',
  'speech',
  'transcription',
])
  test(`discovery accepts singleton ${output} by exact published output membership`, async () => {
    for (const kind of ['managed', 'delegated'] as const) {
      const f = discoveryFixture([discoveryModel('one', { outputs: [output], kind })]);
      const r = await f.handler(f.request(`?output_modalities=${output}`));
      assert.equal(r.status, 200);
      assert.deepEqual(
        ((await r.json()) as List).data.map((m) => m.id),
        ['one'],
      );
      discoveryPrivacy(f);
    }
  });
test('filter-only requests retain full matching lists above the paging default', async () => {
  const f = discoveryFixture(Array.from({ length: 501 }, (_, i) => discoveryModel(`model-${i}`)));
  const r = await f.handler(f.request('?supported_parameters=tools&context=8192'));
  assert.equal(r.status, 200);
  const body = (await r.json()) as List;
  assert.equal(body.data.length, 501);
  assert.equal(body.total_count, 501);
  assert.equal(body.links.next, null);
});
test('combined filters page only matching authorized aliases and preserve every filter in relative links', async () => {
  const f = discoveryFixture();
  const query = '?limit=1&output_modalities=text&context=8192&supported_parameters=tools';
  const first = await f.handler(f.request(query));
  assert.equal(first.status, 200);
  const body = (await first.json()) as List;
  assert.deepEqual(
    body.data.map((m) => m.id),
    ['multi'],
  );
  assert.equal(body.total_count, 2);
  const continuation = body.links.next;
  assert.ok(continuation);
  assert.ok(continuation.startsWith('/api/v1/models?'));
  const next = new URL(continuation, 'http://untrusted.example');
  assert.equal(next.searchParams.get('offset'), '1');
  assert.equal(next.searchParams.get('limit'), '1');
  assert.equal(next.searchParams.get('output_modalities'), 'text');
  assert.equal(next.searchParams.get('supported_parameters'), 'tools');
  assert.equal(next.searchParams.get('context'), '8192');
  assert.equal(next.searchParams.size, 5);
  assert.doesNotMatch(continuation, /untrusted|private/);
  const second = await f.handler(f.request(next.search));
  assert.equal(second.status, 200);
  const tail = (await second.json()) as List;
  assert.deepEqual(
    tail.data.map((m) => m.id),
    ['large'],
  );
  assert.equal(tail.total_count, 2);
  assert.equal(tail.links.next, null);
  discoveryPrivacy(f);
});
test('filtered paging preserves offset/limit defaults and safe beyond-end behavior', async () => {
  for (const query of ['?context=8192&offset=1', '?context=8192&limit=2']) {
    const f = discoveryFixture();
    const r = await f.handler(f.request(query));
    assert.equal(r.status, 200);
    const body = (await r.json()) as List;
    assert.deepEqual(
      body.data.map((m) => m.id),
      query.includes('offset') ? ['large', 'image'] : ['multi', 'large'],
    );
    assert.equal(body.total_count, 3);
  }
  const f = discoveryFixture();
  const r = await f.handler(f.request('?context=8192&offset=9007199254740991&limit=1000'));
  assert.equal(r.status, 200);
  const body = (await r.json()) as List;
  assert.deepEqual(body.data, []);
  assert.equal(body.total_count, 3);
  assert.equal(body.links.next, null);
});
test('unknown metadata cannot establish capability and all does not infer text', async () => {
  const f = discoveryFixture([
    discoveryModel('basic', { basic: true }),
    discoveryModel('null', { context: null }),
    discoveryModel('empty', { outputs: [], parameters: [] }),
  ]);
  for (const [query, ids] of [
    ['?output_modalities=all', ['basic', 'null', 'empty']],
    ['?context=1', ['empty']],
    ['?supported_parameters=tools', ['null']],
    ['?output_modalities=text', ['null']],
  ] as const) {
    const r = await f.handler(f.request(query));
    assert.equal(r.status, 200);
    assert.deepEqual(
      ((await r.json()) as List).data.map((m) => m.id),
      ids,
    );
  }
  discoveryPrivacy(f);
});
test('maximum parameter length is an accepted local boundary', async () => {
  const parameter = 'a'.repeat(128);
  const f = discoveryFixture([discoveryModel('exact', { parameters: [parameter] })]);
  const r = await f.handler(f.request(`?supported_parameters=${parameter}`));
  assert.equal(r.status, 200);
  assert.deepEqual(
    ((await r.json()) as List).data.map((m) => m.id),
    ['exact'],
  );
});
for (const query of [
  '?output_modalities=',
  '?output_modalities=null',
  '?output_modalities=TEXT',
  '?output_modalities=unknown',
  '?output_modalities=text,image',
  '?output_modalities=all,text',
  '?output_modalities=%20text',
  '?output_modalities=text&output_modalities=text',
  '?supported_parameters=',
  '?supported_parameters=Tools',
  '?supported_parameters=tools,temperature',
  '?supported_parameters=%20tools',
  '?supported_parameters=tools&supported_parameters=tools',
  '?supported_parameters=1tools',
  '?supported_parameters=a-b',
  `?supported_parameters=${'a'.repeat(129)}`,
  '?context=0',
  '?context=-1',
  '?context=1.5',
  '?context=1e3',
  '?context=01',
  '?context=%2B1',
  '?context=null',
  '?context=',
  '?context=9007199254740992',
  '?context=8192&context=8192',
  '?context=8192&limit=0',
  '?context=8192&offset=-1',
  '?context=8192&provider=private-filter',
])
  test(`invalid discovery filter fails before catalog reads: ${query.slice(0, 75)}`, async () => {
    const f = discoveryFixture();
    const r = await f.handler(f.request(query));
    assert.equal(r.status, 400);
    assert.equal(f.reads(), 0);
    assert.equal((f.events[0] as { kind: string }).kind, 'request-denied');
    assert.doesNotMatch(await r.text(), /private-filter|supported_parameters|output_modalities/u);
    discoveryPrivacy(f);
  });
test('discovery authentication precedes valid and invalid filters', async () => {
  for (const query of ['?context=8192', '?context=0&provider=private-filter']) {
    const f = discoveryFixture(undefined, { authenticated: false });
    const r = await f.handler(f.request(query));
    assert.equal(r.status, 401);
    assert.equal(f.reads(), 0);
    discoveryPrivacy(f);
  }
});
test('implicit Deny leaves filtered totals and continuation empty', async () => {
  const f = discoveryFixture(undefined, { statements: [] });
  const r = await f.handler(f.request('?context=8192&limit=1'));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    object: 'list',
    data: [],
    total_count: 0,
    links: { next: null },
  });
  discoveryPrivacy(f);
});
test('legacy model queries remain rejected without catalog reads', async () => {
  for (const query of ['?output_modalities=all', '?supported_parameters=tools', '?context=8192']) {
    const f = discoveryFixture();
    const r = await f.handler(f.request(query, '/v1'));
    assert.equal(r.status, 400);
    assert.equal(f.reads(), 0);
  }
});
test('filtered listing retains catalog and required audit failure handling', async () => {
  for (const options of [{ catalogFailure: true }, { auditFailure: true }]) {
    const f = discoveryFixture(undefined, options);
    const r = await f.handler(f.request('?context=8192'));
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /private|catalog\.example|8192/u);
    discoveryPrivacy(f);
  }
});
test('malformed hidden or out-of-page metadata invalidates the entire filtered catalog', async () => {
  for (const enabled of [false, true]) {
    const invalid = {
      ...discoveryModel('private-denied', { enabled }),
      openRouterMetadata: { name: 'private malformed' },
    } as unknown as ReturnType<typeof discoveryModel>;
    const f = discoveryFixture([discoveryModel('valid'), invalid]);
    const r = await f.handler(f.request('?context=8192&limit=1'));
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /private|valid/u);
    discoveryPrivacy(f);
  }
});
test('captured matching metadata survives mutation during required audit', async () => {
  const model = discoveryModel('stable');
  const metadata = model.openRouterMetadata;
  assert.ok(metadata);
  const f = discoveryFixture([model], {
    audit: () => {
      Object.assign(metadata, { context_length: 0 });
      (metadata.supported_parameters as string[]).splice(0);
    },
  });
  const r = await f.handler(f.request('?context=8192&supported_parameters=tools'));
  assert.equal(r.status, 200);
  const body = (await r.json()) as List;
  assert.equal(body.data[0]?.context_length, 8192);
  assert.deepEqual(body.data[0]?.supported_parameters, ['tools']);
  assert.equal(body.total_count, 1);
  discoveryPrivacy(f);
});
test('fresh IAM is reevaluated when following a filtered continuation', async () => {
  const statements = [discoveryAllow];
  const f = discoveryFixture([discoveryModel('first'), discoveryModel('second')], { statements });
  const r = await f.handler(f.request('?context=8192&limit=1'));
  assert.equal(r.status, 200);
  const body = (await r.json()) as List;
  assert.ok(body.links.next);
  statements.splice(0, statements.length, { effect: 'Deny', actions: ['*'], resources: ['*'] });
  const next = await f.handler(f.request(new URL(body.links.next, 'http://localhost').search));
  assert.equal(next.status, 200);
  assert.deepEqual(await next.json(), {
    object: 'list',
    data: [],
    total_count: 0,
    links: { next: null },
  });
});
