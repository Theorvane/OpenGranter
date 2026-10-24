import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalSchema } from '../scripts/openrouter-schema.ts';
import {
  compareOfficialUserModelSchema,
  projectOfficialUserModelSchema,
  validateUserModelSchemaPin,
} from '../scripts/openrouter-user-model-schema.ts';

const pin = JSON.parse(
  await readFile(
    new URL('../contracts/openrouter-user-model-schema.json', import.meta.url),
    'utf8',
  ),
);
const listPin = JSON.parse(
  await readFile(
    new URL('../contracts/openrouter-model-response-schema.json', import.meta.url),
    'utf8',
  ),
);
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const parameters = {
  offset: {
    name: 'offset',
    in: 'query',
    required: false,
    schema: { default: 0, minimum: 0, type: ['integer', 'null'] },
  },
  limit: {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { default: 500, maximum: 1000, minimum: 1, type: 'integer' },
  },
  output_modalities: {
    name: 'output_modalities',
    in: 'query',
    required: false,
    schema: { type: 'string' },
  },
  sort: {
    name: 'sort',
    in: 'query',
    required: false,
    schema: {
      enum: [
        'most-popular',
        'newest',
        'top-weekly',
        'pricing-low-to-high',
        'pricing-high-to-low',
        'context-high-to-low',
        'throughput-high-to-low',
        'latency-low-to-high',
        'intelligence-high-to-low',
        'coding-high-to-low',
        'agentic-high-to-low',
        'design-arena-elo-high-to-low',
      ],
      type: 'string',
      'x-speakeasy-unknown-values': 'allow',
    },
  },
};
const definitions = {
  ModelsListResponse: {
    type: 'object',
    required: ['data', 'total_count', 'links'],
    properties: {
      data: ref('ModelsListResponseData'),
      total_count: { type: 'integer' },
      links: {
        type: 'object',
        required: ['next'],
        properties: { next: { type: ['string', 'null'] } },
      },
    },
  },
  ModelsListResponseData: { type: 'array', items: ref('Model') },
  Model: {
    type: 'object',
    required: ['id', 'name', 'pricing'],
    properties: { id: { type: 'string' }, name: { type: 'string' }, pricing: ref('PublicPricing') },
  },
};
function source() {
  return {
    openapi: '3.1.0',
    info: { version: '1.0.0' },
    paths: {
      '/models/user': {
        parameters: [{ $ref: '#/components/parameters/AppIdentifier' }] as Record<
          string,
          unknown
        >[],
        get: {
          operationId: 'listModelsUser',
          parameters: structuredClone(Object.values(parameters)) as Record<string, unknown>[],
          security: [{ bearer: [] }] as unknown,
          responses: {
            '200': {
              content: { 'application/json': { schema: ref('ModelsListResponse') } },
            } as Record<string, unknown>,
          },
        },
      },
    },
    components: {
      schemas: structuredClone(definitions) as Record<string, Record<string, unknown>>,
    },
  };
}
function rehashed(projection: unknown) {
  return {
    ...pin,
    projection,
    projectionSha256: createHash('sha256').update(canonicalSchema(projection)).digest('hex'),
  };
}
function baseline() {
  return rehashed(projectOfficialUserModelSchema(source()));
}
function parameter(s: ReturnType<typeof source>, name: string) {
  const entry = s.paths['/models/user'].get.parameters.find((p) => p.name === name);
  assert.ok(entry);
  return entry;
}
function invalidSource(s: unknown) {
  assert.throws(() => projectOfficialUserModelSchema(s), {
    name: 'TypeError',
    message: 'Invalid official user-model schema',
  });
}
function invalidPin(p: unknown) {
  assert.throws(() => validateUserModelSchemaPin(p), {
    name: 'TypeError',
    message: 'Invalid user-model schema pin',
  });
}
test('user-model projection independently captures the query, bearer security and list/array/item chain', () => {
  const expected = {
    openapi: '3.1.0',
    documentVersion: '1.0.0',
    path: '/models/user',
    method: 'get',
    operationId: 'listModelsUser',
    parameters,
    security: [{ bearer: [] }],
    status: '200',
    mediaType: 'application/json',
    schema: ref('ModelsListResponse'),
    definitions,
  };
  assert.deepEqual(projectOfficialUserModelSchema(source()), expected);
  assert.equal(compareOfficialUserModelSchema(source(), rehashed(expected)), true);
  assert.equal(pin.version, 1);
  assert.deepEqual(validateUserModelSchemaPin(pin).projection, pin.projection);
  assert.deepEqual(pin.projection.parameters, parameters);
  assert.deepEqual(pin.projection.security, [{ bearer: [] }]);
  assert.deepEqual(Object.keys(pin.projection.definitions).sort(), [
    'Model',
    'ModelsListResponse',
    'ModelsListResponseData',
  ]);
  assert.deepEqual(pin.projection.definitions.ModelsListResponse, definitions.ModelsListResponse);
  assert.deepEqual(
    pin.projection.definitions.ModelsListResponseData,
    definitions.ModelsListResponseData,
  );
  assert.deepEqual(pin.projection.definitions.Model, listPin.projection.definitions.Model);
});
for (const name of Object.keys(parameters)) {
  for (const [key, value] of [
    ['style', 'form'],
    ['explode', false],
    ['allowReserved', true],
    ['required', true],
    ['x-literal', { description: 'literal' }],
  ] as const)
    test(`user ${name} parameter ${key} drift remains structural`, () => {
      const s = source();
      Object.assign(parameter(s, name), { [key]: value });
      assert.equal(compareOfficialUserModelSchema(s, baseline()), false);
    });
  for (const [key, value] of [
    ['type', 'boolean'],
    ['default', 9],
    ['minimum', 8],
    ['nullable', true],
    ['enum', ['different']],
    ['x-client', { examples: ['literal'] }],
  ] as const)
    test(`user ${name} schema ${key} drift is detected`, () => {
      const s = source();
      Object.assign(parameter(s, name).schema as object, { [key]: value });
      assert.equal(compareOfficialUserModelSchema(s, baseline()), false);
    });
  test(`user ${name} missing, duplicate, inherited and malformed parameters fail privately`, () => {
    for (const change of [
      'missing',
      'duplicate',
      'inherited',
      'reference',
      'content',
      'location',
      'required',
      'empty-schema',
      'null-schema',
      'bad-ref',
    ]) {
      const s = source();
      const path = s.paths['/models/user'];
      const p = parameter(s, name);
      if (change === 'missing')
        path.get.parameters = path.get.parameters.filter((p) => p.name !== name);
      else if (change === 'duplicate') path.get.parameters.push(structuredClone(p));
      else if (change === 'inherited') path.parameters.push(structuredClone(p));
      else if (change === 'reference') p.$ref = 'private-reference';
      else if (change === 'content') p.content = { 'application/json': {} };
      else if (change === 'location') p.in = 'header';
      else if (change === 'required') p.required = 'private-invalid';
      else p.schema = change === 'empty-schema' ? {} : change === 'bad-ref' ? { $ref: null } : null;
      invalidSource(s);
    }
  });
}
for (const name of Object.keys(definitions)) {
  test(`user ${name} selected definition drift is detected behind stable response references`, () => {
    for (const patch of [
      { required: [] },
      { properties: { changed: { type: 'boolean' } } },
      { $ref: '#/components/schemas/Changed' },
      { 'x-literal': { description: 'literal' } },
    ]) {
      const s = source();
      Object.assign(s.components.schemas[name] ?? {}, patch);
      assert.equal(compareOfficialUserModelSchema(s, baseline()), false);
    }
  });
  test(`user ${name} missing/malformed source and rehashed pin definitions fail privately`, () => {
    for (const value of [undefined, null, [], 'private-source', {}]) {
      const s = source();
      const p = structuredClone(pin.projection);
      if (value === undefined) {
        delete s.components.schemas[name];
        delete p.definitions[name];
      } else {
        Reflect.set(s.components.schemas, name, value);
        p.definitions[name] = value;
      }
      invalidSource(s);
      invalidPin(rehashed(p));
    }
  });
}
for (const security of [
  [],
  [{}],
  [{ other: [] }],
  [{ bearer: ['scope'] }],
  [{ bearer: [], other: [] }],
  [{ description: [] }],
])
  test(`user security ${JSON.stringify(security)} is literal structural drift, not an annotation`, () => {
    const s = source();
    s.paths['/models/user'].get.security = security;
    assert.equal(compareOfficialUserModelSchema(s, baseline()), false);
    invalidPin(rehashed({ ...pin.projection, security }));
  });
test('user missing or malformed explicit security never inherits top-level security', () => {
  for (const security of [
    undefined,
    null,
    {},
    'private-security',
    [null],
    [[]],
    [{ bearer: 'private-scope' }],
    [{ bearer: [2] }],
  ]) {
    const s = source();
    s.paths['/models/user'].get.security = security;
    Object.assign(s, { security: [{ bearer: [] }] });
    invalidSource(s);
    const p = { ...pin.projection, security };
    if (security === undefined) delete p.security;
    invalidPin(rehashed(p));
  }
});
test('user root and operation/document identity changes report drift without echoing input', () => {
  for (const key of ['operation', 'openapi', 'version', 'root']) {
    const s = source();
    if (key === 'operation') s.paths['/models/user'].get.operationId = 'private-operation';
    else if (key === 'openapi') s.openapi = '3.0.0';
    else if (key === 'version') s.info.version = '2.0.0';
    else
      s.paths['/models/user'].get.responses['200'].content = {
        'application/json': { schema: ref('Changed') },
      };
    assert.equal(compareOfficialUserModelSchema(s, baseline()), false);
  }
});
test('user malformed source envelopes, response references and inherited parameter lists fail privately', () => {
  for (const change of [
    'path',
    'operation',
    'parameters',
    'entry',
    'inherited-list',
    'inherited-entry',
    'response',
    'response-ref',
    'media',
    'root',
    'info',
    'openapi',
  ]) {
    const s = source();
    const path = s.paths['/models/user'];
    const op = path.get;
    if (change === 'path') Reflect.deleteProperty(s.paths, '/models/user');
    else if (change === 'operation') Reflect.deleteProperty(path, 'get');
    else if (change === 'parameters') Reflect.set(op, 'parameters', null);
    else if (change === 'entry') Reflect.set(op.parameters, 0, null);
    else if (change === 'inherited-list') Reflect.set(path, 'parameters', {});
    else if (change === 'inherited-entry') Reflect.set(path.parameters, 0, null);
    else if (change === 'response') Reflect.deleteProperty(op.responses, '200');
    else if (change === 'response-ref') op.responses['200'].$ref = 'private-response';
    else if (change === 'media') op.responses['200'].content = {};
    else if (change === 'root')
      op.responses['200'].content = { 'application/json': { schema: {} } };
    else if (change === 'info') Reflect.deleteProperty(s.info, 'version');
    else s.openapi = '';
    invalidSource(s);
  }
});
test('user schema annotations and unselected graphs are ignored; selected literal map keys remain structural', () => {
  const s = source();
  Object.assign(parameter(s, 'offset'), { description: 'editorial', examples: ['editorial'] });
  Object.assign(s.components.schemas.Model ?? {}, {
    description: 'editorial',
    examples: ['editorial'],
  });
  s.components.schemas.PublicPricing = { type: 'boolean' };
  Object.assign(s, { security: [{ other: [] }] });
  assert.equal(compareOfficialUserModelSchema(s, baseline()), true);
  (s.components.schemas.Model ?? {}).properties = { description: { type: 'boolean' } };
  assert.equal(compareOfficialUserModelSchema(s, baseline()), false);
});
test('user parameter ordering and inherited unrelated references do not change selection', () => {
  const s = source();
  s.paths['/models/user'].get.parameters.reverse();
  s.paths['/models/user'].get.parameters.push({
    name: 'unselected',
    in: 'query',
    schema: { type: 'boolean' },
  });
  assert.equal(compareOfficialUserModelSchema(s, baseline()), true);
  Reflect.deleteProperty(s.paths['/models/user'], 'parameters');
  assert.equal(compareOfficialUserModelSchema(s, baseline()), true);
});
test('user pin envelope, hashes, dates and canonical exact selected maps reject corruption', () => {
  for (const patch of [
    { version: 0 },
    { version: 2 },
    { source: 'https://untrusted.invalid/schema' },
    { retrievedAt: '2026-02-30' },
    { retrievedAt: 'private-date' },
    { sourceSha256: 'ABC' },
    { projectionSha256: '0'.repeat(64) },
    { extra: true },
  ])
    invalidPin({ ...pin, ...patch });
  for (const key of Object.keys(pin)) {
    const p = { ...pin };
    delete p[key];
    invalidPin(p);
  }
  for (const patch of [
    { path: '/models' },
    { method: 'post' },
    { operationId: 'changed' },
    { openapi: '3.0.0' },
    { documentVersion: '' },
    { status: '201' },
    { mediaType: 'text/event-stream' },
    { schema: ref('Other') },
    { extra: true },
    { parameters: { ...pin.projection.parameters, extra: {} } },
    { definitions: { ...pin.projection.definitions, extra: {} } },
  ])
    invalidPin(rehashed({ ...pin.projection, ...patch }));
  const editorial = structuredClone(pin.projection);
  editorial.definitions.Model.description = 'editorial';
  invalidPin(rehashed(editorial));
  for (const name of Object.keys(parameters)) {
    const p = structuredClone(pin.projection);
    delete p.parameters[name];
    invalidPin(rehashed(p));
  }
});
