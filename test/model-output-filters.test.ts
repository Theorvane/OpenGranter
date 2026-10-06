import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoveryAllow,
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

type List = {
  data: Array<{ id: string; architecture?: { output_modalities: string[] } }>;
  total_count: number;
  links: { next: string | null };
};
const outputs = [
  'text',
  'image',
  'embeddings',
  'audio',
  'video',
  'rerank',
  'decisions',
  'speech',
  'transcription',
];
for (const [value, expected] of [
  ['text,image', ['small', 'multi', 'unknown', 'large', 'image']],
  ['image,text', ['small', 'multi', 'unknown', 'large', 'image']],
  ['image,audio', ['multi', 'large', 'image']],
  ['audio,video', []],
] as const)
  test(`output list matches any authorized published modality: ${value}`, async () => {
    const f = discoveryFixture();
    const response = await f.handler(f.request(`?output_modalities=${value}`));
    assert.equal(response.status, 200);
    const body = (await response.json()) as List;
    assert.deepEqual(
      body.data.map((m) => m.id),
      expected,
    );
    assert.equal(body.total_count, expected.length);
    assert.equal(body.links.next, null);
    assert.equal(f.reads(), 1);
    discoveryPrivacy(f);
  });
for (const kind of ['managed', 'delegated'] as const)
  test(`all nine output values match exact metadata on ${kind} without inferring missing capability`, async () => {
    const f = discoveryFixture([
      ...outputs.map((output) => discoveryModel(output, { outputs: [output], kind })),
      discoveryModel('basic', { basic: true, kind }),
      discoveryModel('empty', { outputs: [], kind }),
      discoveryModel('other', { outputs: ['future-output'], kind }),
    ]);
    const response = await f.handler(f.request(`?output_modalities=${outputs.join(',')}`));
    assert.equal(response.status, 200);
    assert.deepEqual(
      ((await response.json()) as List).data.map((m) => m.id),
      outputs,
    );
    discoveryPrivacy(f);
  });
test('output union combines with input, parameter, context, literal search and stable ordering before paging', async () => {
  const f = discoveryFixture([
    discoveryModel('Atlas image', { outputs: ['image'], created: 1 }),
    discoveryModel('Atlas text', { outputs: ['text'], created: 2 }),
    discoveryModel('Atlas wrong-input', { inputs: ['audio'] }),
    discoveryModel('Atlas wrong-parameter', { parameters: [] }),
    discoveryModel('Atlas small', { context: 1 }),
    discoveryModel('Atlas wrong-output', { outputs: ['audio'] }),
    discoveryModel('not-search', { name: 'another', slug: 'another' }),
    discoveryModel('Atlas disabled', { enabled: false }),
    discoveryModel('private-denied'),
    discoveryModel('Atlas provider-denied', { provider: 'private-provider' }),
  ]);
  const query =
    '?output_modalities=image%2Ctext&input_modalities=text&supported_parameters=tools&context=8192&q=Atlas&sort=newest&limit=1';
  const response = await f.handler(f.request(query));
  assert.equal(response.status, 200);
  const first = (await response.json()) as List;
  assert.deepEqual(
    first.data.map((m) => m.id),
    ['Atlas text'],
  );
  assert.equal(first.total_count, 2);
  assert.ok(first.links.next);
  const url = new URL(first.links.next, 'http://localhost');
  assert.equal(url.pathname, '/api/v1/models');
  assert.equal(url.searchParams.get('output_modalities'), 'image,text');
  assert.equal(url.searchParams.getAll('output_modalities').length, 1);
  for (const key of ['input_modalities', 'supported_parameters', 'context', 'q', 'sort', 'limit'])
    assert.equal(url.searchParams.get(key), new URLSearchParams(query).get(key));
  assert.equal(url.searchParams.size, 8);
  assert.doesNotMatch(first.links.next, /untrusted|private/u);
  const second = await f.handler(f.request(url.search));
  assert.equal(second.status, 200);
  const last = (await second.json()) as List;
  assert.deepEqual(
    last.data.map((m) => m.id),
    ['Atlas image'],
  );
  assert.equal(last.total_count, 2);
  assert.equal(last.links.next, null);
  discoveryPrivacy(f);
});
test('output union without paging returns every matching alias above500', async () => {
  const f = discoveryFixture(
    Array.from({ length: 501 }, (_, i) =>
      discoveryModel(`alias-${i}`, { outputs: [i % 2 ? 'image' : 'text'] }),
    ),
  );
  const response = await f.handler(f.request('?output_modalities=text,image'));
  assert.equal(response.status, 200);
  const body = (await response.json()) as List;
  assert.equal(body.data.length, 501);
  assert.equal(body.total_count, 501);
  assert.equal(body.links.next, null);
});
for (const value of [
  'text,',
  ',text',
  'text,,image',
  'text,text',
  'image,text,image',
  'all,text',
  'text,all',
  'all,all',
  'text,IMAGE',
  'text,unknown',
  'text,%20image',
  'text,image%20',
  'text,%09image',
  'text,%00image',
  outputs.concat('text').join(','),
  Array(1000).fill('text').join(','),
])
  test(`invalid output list fails before catalog reads: ${value.slice(0, 60)}`, async () => {
    const f = discoveryFixture();
    const response = await f.handler(f.request(`?output_modalities=${value}`));
    assert.equal(response.status, 400);
    assert.equal(f.reads(), 0);
    assert.equal((f.events[0] as { kind: string }).kind, 'request-denied');
    assert.doesNotMatch(await response.text(), /output_modalities|unknown|IMAGE/u);
    discoveryPrivacy(f);
  });
for (const query of [
  '?output_modalities=text,image&output_modalities=text,image',
  '?output_modalities=text,image&input_modalities=text,unknown',
  '?output_modalities=text,image&supported_parameters=tools,Temperature',
  '?output_modalities=text,image&provider=private-filter',
])
  test(`output lists do not broaden other query acceptance: ${query}`, async () => {
    const f = discoveryFixture();
    assert.equal((await f.handler(f.request(query))).status, 400);
    assert.equal(f.reads(), 0);
    discoveryPrivacy(f);
  });
for (const query of ['?output_modalities=text,image', '?output_modalities=text,unknown'])
  test(`authentication precedes output list parsing: ${query}`, async () => {
    const f = discoveryFixture(undefined, { authenticated: false });
    assert.equal((await f.handler(f.request(query))).status, 401);
    assert.equal(f.reads(), 0);
    discoveryPrivacy(f);
  });
test('legacy output lists reject before catalog reads', async () => {
  const f = discoveryFixture();
  assert.equal((await f.handler(f.request('?output_modalities=text,image', '/v1'))).status, 400);
  assert.equal(f.reads(), 0);
});
for (const statements of [[], [{ effect: 'Deny' as const, actions: ['*'], resources: ['*'] }]])
  test(`implicit or explicit denial hides output union totals: ${statements.length}`, async () => {
    const f = discoveryFixture(undefined, { statements });
    const response = await f.handler(f.request('?output_modalities=text,image&limit=1'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: 'list',
      data: [],
      total_count: 0,
      links: { next: null },
    });
    discoveryPrivacy(f);
  });
test('output list continuation reevaluates both model and provider Deny', async () => {
  const f = discoveryFixture(
    [
      discoveryModel('first'),
      discoveryModel('second'),
      discoveryModel('third', { provider: 'other' }),
    ],
    { statements: [discoveryAllow] },
  );
  const response = await f.handler(f.request('?output_modalities=text,image&limit=1'));
  assert.equal(response.status, 200);
  const first = (await response.json()) as List;
  assert.ok(first.links.next);
  f.statements.push({
    effect: 'Deny',
    actions: ['*'],
    resources: ['model:second', 'provider:other'],
  });
  const next = await f.handler(f.request(new URL(first.links.next, 'http://localhost').search));
  assert.equal(next.status, 200);
  const body = (await next.json()) as List;
  assert.deepEqual(body.data, []);
  assert.equal(body.total_count, 1);
  assert.equal(body.links.next, null);
  discoveryPrivacy(f);
});
for (const options of [{ catalogFailure: true }, { auditFailure: true }])
  test(`output lists retain safe required dependency failure: ${JSON.stringify(options)}`, async () => {
    const f = discoveryFixture(undefined, options);
    const response = await f.handler(f.request('?output_modalities=text,image'));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private|text,image|output_modalities/u);
    discoveryPrivacy(f);
  });
test('output lists validate malformed denied metadata before filtering and paging', async () => {
  const invalid = {
    ...discoveryModel('private-denied'),
    openRouterMetadata: { name: 'private malformed' },
  } as unknown as ReturnType<typeof discoveryModel>;
  const f = discoveryFixture([discoveryModel('valid'), invalid]);
  assert.equal((await f.handler(f.request('?output_modalities=text,image&limit=1'))).status, 503);
  discoveryPrivacy(f);
});
test('output list matching and response capture survive required audit source mutation', async () => {
  const model = discoveryModel('stable', { outputs: ['image'] });
  const metadata = model.openRouterMetadata;
  assert.ok(metadata);
  const f = discoveryFixture([model], {
    audit: () => {
      (metadata.architecture.output_modalities as string[]).splice(0);
    },
  });
  const response = await f.handler(f.request('?output_modalities=text,image'));
  assert.equal(response.status, 200);
  const body = (await response.json()) as List;
  assert.deepEqual(
    body.data.map((m) => m.id),
    ['stable'],
  );
  assert.deepEqual(body.data[0]?.architecture?.output_modalities, ['image']);
  discoveryPrivacy(f);
});
