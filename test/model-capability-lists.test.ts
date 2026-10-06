import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityCatalog, capabilityQuery } from './model-capability-lists-fixture.ts';
import {
  discoveryAllow,
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

type List = {
  data: Array<{
    id: string;
    architecture?: { input_modalities: string[] };
    supported_parameters?: string[];
  }>;
  total_count: number;
  links: { next: string | null };
};
for (const kind of ['managed', 'delegated'] as const)
  for (const [query, expected] of [
    ['?input_modalities=text,image', ['first', 'partial-parameter', 'second', 'third', 'small']],
    ['?input_modalities=image,text', ['first', 'partial-parameter', 'second', 'third', 'small']],
    [
      '?supported_parameters=tools,temperature',
      ['first', 'partial-input', 'second', 'third', 'small'],
    ],
    [
      '?supported_parameters=temperature,tools',
      ['first', 'partial-input', 'second', 'third', 'small'],
    ],
    [
      '?input_modalities=text,image&supported_parameters=tools,temperature',
      ['first', 'second', 'third', 'small'],
    ],
    [
      '?input_modalities=text,image&supported_parameters=tools,temperature&output_modalities=text,image',
      ['first', 'second', 'small'],
    ],
    [
      '?input_modalities=text,image&output_modalities=all',
      ['first', 'partial-parameter', 'second', 'third', 'small'],
    ],
    ['?input_modalities=audio,file', []],
    ['?supported_parameters=tools,unknown_parameter', []],
    ['?supported_parameters=all,tools', []],
  ] as const)
    test(`all-member capability list ${kind}: ${query}`, async () => {
      const f = discoveryFixture(capabilityCatalog(kind));
      const response = await f.handler(f.request(query));
      assert.equal(response.status, 200);
      const body = (await response.json()) as List;
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
test('all four input values require all four published capabilities', async () => {
  const inputs = ['text', 'image', 'audio', 'file'];
  const f = discoveryFixture([
    discoveryModel('all-four', { inputs }),
    ...inputs.map((input) => discoveryModel(input, { inputs: [input] })),
  ]);
  const response = await f.handler(f.request(`?input_modalities=${inputs.join(',')}`));
  assert.equal(response.status, 200);
  assert.deepEqual(
    ((await response.json()) as List).data.map((m) => m.id),
    ['all-four'],
  );
  discoveryPrivacy(f);
});
test('64 distinct128-character parameters are accepted and every token is required', async () => {
  const parameters = Array.from(
    { length: 64 },
    (_, i) => `p${i}${'a'.repeat(127 - String(i).length)}`,
  );
  assert.ok(parameters.every((p) => p.length === 128));
  const f = discoveryFixture([
    discoveryModel('all-parameters', { parameters }),
    discoveryModel('partial', { parameters: parameters.slice(1) }),
  ]);
  const response = await f.handler(f.request(`?supported_parameters=${parameters.join(',')}`));
  assert.equal(response.status, 200);
  assert.deepEqual(
    ((await response.json()) as List).data.map((m) => m.id),
    ['all-parameters'],
  );
  discoveryPrivacy(f);
});
test('unknown and all parameter identifiers match only exact administrator-published tokens', async () => {
  const f = discoveryFixture([
    discoveryModel('future', { parameters: ['tools', 'future_parameter'] }),
    discoveryModel('literal-all', { parameters: ['all', 'tools'] }),
    discoveryModel('ordinary'),
  ]);
  for (const [parameters, expected] of [
    ['tools,future_parameter', 'future'],
    ['all,tools', 'literal-all'],
  ] as const) {
    const response = await f.handler(f.request(`?supported_parameters=${parameters}`));
    assert.equal(response.status, 200);
    assert.deepEqual(
      ((await response.json()) as List).data.map((m) => m.id),
      [expected],
    );
  }
  discoveryPrivacy(f);
});
test('capability continuations retain all eight fields and apply search/order/output union before paging', async () => {
  const f = discoveryFixture(capabilityCatalog());
  const response = await f.handler(f.request(capabilityQuery));
  assert.equal(response.status, 200);
  const first = (await response.json()) as List;
  assert.deepEqual(
    first.data.map((m) => m.id),
    ['first'],
  );
  assert.equal(first.total_count, 2);
  assert.ok(first.links.next);
  const url = new URL(first.links.next, 'http://localhost');
  assert.equal(url.pathname, '/api/v1/models');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    offset: '1',
    limit: '1',
    output_modalities: 'image,text',
    supported_parameters: 'temperature,tools',
    context: '8192',
    input_modalities: 'image,text',
    q: 'ATLAS',
    sort: 'newest',
  });
  assert.doesNotMatch(first.links.next, /untrusted|private/u);
  const response2 = await f.handler(f.request(url.search));
  assert.equal(response2.status, 200);
  const second = (await response2.json()) as List;
  assert.deepEqual(
    second.data.map((m) => m.id),
    ['second'],
  );
  assert.equal(second.total_count, 2);
  assert.equal(second.links.next, null);
  discoveryPrivacy(f);
});
test('capability lists without paging return all501 matches', async () => {
  const f = discoveryFixture(
    Array.from({ length: 501 }, (_, i) =>
      discoveryModel(`alias-${i}`, {
        inputs: ['text', 'image'],
        parameters: ['tools', 'temperature'],
      }),
    ),
  );
  const response = await f.handler(
    f.request('?input_modalities=text,image&supported_parameters=tools,temperature'),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as List;
  assert.equal(body.data.length, 501);
  assert.equal(body.total_count, 501);
  assert.equal(body.links.next, null);
});
for (const [field, values] of [
  [
    'input_modalities',
    [
      'text,',
      ',image',
      'text,,image',
      'text,text',
      'all,image',
      'text,video',
      'text,IMAGE',
      'text,%20image',
      'text,image%20',
      'text,%00image',
      'text,image,audio,file,text',
    ],
  ],
  [
    'supported_parameters',
    [
      'tools,',
      ',temperature',
      'tools,,temperature',
      'tools,tools',
      'tools,Temperature',
      'tools,%20temperature',
      'tools,temperature%20',
      'tools,1bad',
      'tools,a-b',
      'tools,%00bad',
      `tools,${'a'.repeat(129)}`,
      Array.from({ length: 65 }, (_, i) => `p${i}`).join(','),
    ],
  ],
] as const)
  for (const value of values)
    test(`invalid capability list rejects before catalog: ${field}=${value.slice(0, 50)}`, async () => {
      const f = discoveryFixture();
      const response = await f.handler(f.request(`?${field}=${value}`));
      assert.equal(response.status, 400);
      assert.equal(f.reads(), 0);
      assert.equal((f.events[0] as { kind: string }).kind, 'request-denied');
      assert.doesNotMatch(
        await response.text(),
        /input_modalities|supported_parameters|Temperature|a-b/u,
      );
      discoveryPrivacy(f);
    });
for (const field of ['input_modalities', 'supported_parameters'])
  test(`repeated capability query key rejects: ${field}`, async () => {
    const value = field === 'input_modalities' ? 'text,image' : 'tools,temperature';
    const f = discoveryFixture();
    assert.equal((await f.handler(f.request(`?${field}=${value}&${field}=${value}`))).status, 400);
    assert.equal(f.reads(), 0);
  });
for (const query of [
  capabilityQuery,
  '?input_modalities=text,unknown',
  '?supported_parameters=tools,',
])
  test(`authentication precedes capability syntax: ${query.slice(0, 60)}`, async () => {
    const f = discoveryFixture(undefined, { authenticated: false });
    assert.equal((await f.handler(f.request(query))).status, 401);
    assert.equal(f.reads(), 0);
    discoveryPrivacy(f);
  });
test('legacy capability lists reject and invalid audit failure withholds400', async () => {
  const f = discoveryFixture();
  assert.equal((await f.handler(f.request(capabilityQuery, '/v1'))).status, 400);
  assert.equal(f.reads(), 0);
  const broken = discoveryFixture(undefined, { auditFailure: true });
  assert.equal(
    (await broken.handler(broken.request('?input_modalities=text,unknown'))).status,
    503,
  );
  assert.equal(broken.reads(), 0);
  discoveryPrivacy(broken);
});
for (const statements of [[], [{ effect: 'Deny' as const, actions: ['*'], resources: ['*'] }]])
  test(`capability lists retain implicit/explicit Deny: ${statements.length}`, async () => {
    const f = discoveryFixture(capabilityCatalog(), { statements });
    const response = await f.handler(f.request(capabilityQuery));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: 'list',
      data: [],
      total_count: 0,
      links: { next: null },
    });
    discoveryPrivacy(f);
  });
test('fresh capability continuation evaluates model and final-provider Deny', async () => {
  const f = discoveryFixture(capabilityCatalog(), { statements: [discoveryAllow] });
  const response = await f.handler(f.request(capabilityQuery));
  assert.equal(response.status, 200);
  const first = (await response.json()) as List;
  assert.ok(first.links.next);
  f.statements.push({
    effect: 'Deny',
    actions: ['*'],
    resources: ['model:second', 'provider:private-provider'],
  });
  const response2 = await f.handler(
    f.request(new URL(first.links.next, 'http://localhost').search),
  );
  assert.equal(response2.status, 200);
  const next = (await response2.json()) as List;
  assert.equal(next.total_count, 2);
  assert.deepEqual(
    next.data.map((m) => m.id),
    ['first'],
  );
  assert.equal(next.links.next, null);
  discoveryPrivacy(f);
});
for (const options of [{ catalogFailure: true }, { auditFailure: true }])
  test(`capability list dependency failure stays private: ${JSON.stringify(options)}`, async () => {
    const f = discoveryFixture(capabilityCatalog(), options);
    const response = await f.handler(f.request(capabilityQuery));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private|image|tools|ATLAS/u);
    discoveryPrivacy(f);
  });
test('malformed denied metadata invalidates the whole capability catalog', async () => {
  const models = capabilityCatalog();
  const hidden = models.at(-2);
  assert.ok(hidden);
  Object.assign(hidden, { openRouterMetadata: { private: 'malformed' } });
  const f = discoveryFixture(models);
  assert.equal((await f.handler(f.request(capabilityQuery))).status, 503);
  discoveryPrivacy(f);
});
test('audit mutation cannot rewrite captured required capabilities or selected response', async () => {
  const models = capabilityCatalog();
  const metadata = models[0]?.openRouterMetadata;
  assert.ok(metadata);
  const f = discoveryFixture(models, {
    audit: () => {
      (metadata.architecture.input_modalities as string[]).splice(0);
      (metadata.supported_parameters as string[]).splice(0);
    },
  });
  const response = await f.handler(f.request(capabilityQuery));
  assert.equal(response.status, 200);
  const body = (await response.json()) as List;
  assert.deepEqual(
    body.data.map((m) => m.id),
    ['first'],
  );
  assert.deepEqual(body.data[0]?.architecture?.input_modalities, ['text', 'image']);
  assert.deepEqual(body.data[0]?.supported_parameters, ['tools', 'temperature']);
  discoveryPrivacy(f);
});
