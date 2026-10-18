import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalSchema } from '../scripts/openrouter-schema.ts';
import {
  compareOfficialSingleModelSchema,
  projectOfficialSingleModelSchema,
  validateSingleModelSchemaPin,
} from '../scripts/openrouter-single-model-schema.ts';

const pin = JSON.parse(
  await readFile(
    new URL('../contracts/openrouter-single-model-schema.json', import.meta.url),
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
const envelope = { type: 'object', required: ['data'], properties: { data: ref('Model') } };
const model = {
  type: 'object',
  required: ['id', 'name', 'pricing'],
  properties: { id: { type: 'string' }, name: { type: 'string' }, pricing: ref('PublicPricing') },
};
function source() {
  return {
    openapi: '3.1.0',
    info: { version: '1.0.0' },
    paths: {
      '/model/{author}/{slug}': {
        parameters: [{ $ref: '#/components/parameters/AppIdentifier' }] as Record<
          string,
          unknown
        >[],
        get: {
          operationId: 'getModel',
          parameters: ['author', 'slug'].map(
            (name) =>
              ({ name, in: 'path', required: true, schema: { type: 'string' } }) as Record<
                string,
                unknown
              >,
          ),
          responses: {
            '200': { content: { 'application/json': { schema: ref('ModelResponse') } } } as Record<
              string,
              unknown
            >,
          },
        },
      },
    },
    components: {
      schemas: {
        ModelResponse: structuredClone(envelope),
        Model: structuredClone(model),
      } as Record<string, Record<string, unknown>>,
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
  return rehashed(projectOfficialSingleModelSchema(source()));
}
function parameter(s: ReturnType<typeof source>, name: string) {
  const entry = s.paths['/model/{author}/{slug}'].get.parameters.find((p) => p.name === name);
  assert.ok(entry);
  return entry;
}
function invalidSource(s: unknown) {
  assert.throws(() => projectOfficialSingleModelSchema(s), {
    name: 'TypeError',
    message: 'Invalid official single-model schema',
  });
}
function invalidPin(p: unknown) {
  assert.throws(() => validateSingleModelSchemaPin(p), {
    name: 'TypeError',
    message: 'Invalid single-model schema pin',
  });
}
test('single-model projection has independent path parameters, success reference and whole selected definitions', () => {
  const expected = {
    openapi: '3.1.0',
    documentVersion: '1.0.0',
    path: '/model/{author}/{slug}',
    method: 'get',
    operationId: 'getModel',
    parameters: Object.fromEntries(
      ['author', 'slug'].map((name) => [
        name,
        { name, in: 'path', required: true, schema: { type: 'string' } },
      ]),
    ),
    status: '200',
    mediaType: 'application/json',
    schema: ref('ModelResponse'),
    definitions: { ModelResponse: envelope, Model: model },
  };
  assert.deepEqual(projectOfficialSingleModelSchema(source()), expected);
  assert.equal(compareOfficialSingleModelSchema(source(), rehashed(expected)), true);
  assert.equal(pin.version, 1);
  assert.deepEqual(validateSingleModelSchemaPin(pin).projection, pin.projection);
  assert.deepEqual(pin.projection.parameters, expected.parameters);
  assert.deepEqual(pin.projection.definitions.ModelResponse, envelope);
  assert.deepEqual(Object.keys(pin.projection.definitions).sort(), ['Model', 'ModelResponse']);
  assert.deepEqual(pin.projection.definitions.Model, listPin.projection.definitions.Model);
  assert.deepEqual(pin.projection.definitions.Model.required, [
    'id',
    'canonical_slug',
    'name',
    'created',
    'pricing',
    'context_length',
    'architecture',
    'top_provider',
    'per_request_limits',
    'supported_parameters',
    'default_parameters',
    'supported_voices',
    'links',
  ]);
});
for (const name of ['author', 'slug']) {
  for (const [key, value] of [
    ['style', 'simple'],
    ['explode', false],
    ['allowReserved', true],
    ['x-literal', { description: 'literal' }],
  ] as const)
    test(`${name} parameter ${key} remains structural`, () => {
      const s = source();
      Object.assign(parameter(s, name), { [key]: value });
      assert.equal(compareOfficialSingleModelSchema(s, baseline()), false);
    });
  for (const [key, value] of [
    ['type', ['string', 'null']],
    ['default', 'default'],
    ['minLength', 1],
    ['maxLength', 128],
    ['enum', ['fixed']],
    ['x-client', { examples: ['literal'] }],
  ] as const)
    test(`${name} schema ${key} detects drift without inventing runtime constraints`, () => {
      const s = source();
      Object.assign(parameter(s, name).schema as object, { [key]: value });
      assert.equal(compareOfficialSingleModelSchema(s, baseline()), false);
    });
  test(`${name} missing duplicate inherited reference location and required failures are private`, () => {
    for (const change of [
      'missing',
      'duplicate',
      'inherited',
      'reference',
      'content',
      'location',
      'optional',
      'absent-required',
      'empty-schema',
      'null-schema',
    ]) {
      const s = source();
      const path = s.paths['/model/{author}/{slug}'];
      const p = parameter(s, name);
      if (change === 'missing')
        path.get.parameters = path.get.parameters.filter((p) => p.name !== name);
      else if (change === 'duplicate') path.get.parameters.push(structuredClone(p));
      else if (change === 'inherited') path.parameters.push(structuredClone(p));
      else if (change === 'reference') p.$ref = '#/components/parameters/Private';
      else if (change === 'content') p.content = { 'application/json': {} };
      else if (change === 'location') p.in = 'query';
      else if (change === 'optional') p.required = false;
      else if (change === 'absent-required') delete p.required;
      else p.schema = change === 'empty-schema' ? {} : null;
      invalidSource(s);
    }
  });
}
for (const name of ['ModelResponse', 'Model']) {
  test(`${name} required, property, reference and extension drift is detected behind unchanged success refs`, () => {
    for (const patch of [
      { required: [] },
      { properties: { changed: { type: ['string', 'null'] } } },
      { $ref: '#/components/schemas/Changed' },
      { 'x-literal': { description: 'literal' } },
    ]) {
      const s = source();
      Object.assign(s.components.schemas[name] ?? {}, patch);
      assert.equal(compareOfficialSingleModelSchema(s, baseline()), false);
    }
  });
  test(`${name} missing/malformed sources and rehashed maps fail safely`, () => {
    for (const value of [undefined, null, [], 'private-source', {}]) {
      const s = source();
      if (value === undefined) delete s.components.schemas[name];
      else Reflect.set(s.components.schemas, name, value);
      invalidSource(s);
      const p = structuredClone(pin.projection);
      if (value === undefined) delete p.definitions[name];
      else p.definitions[name] = value;
      invalidPin(rehashed(p));
    }
  });
}
test('root schema and operation/document identities detect changes; referenced response objects fail privately', () => {
  for (const key of ['operation', 'openapi', 'version', 'root']) {
    const s = source();
    if (key === 'operation') s.paths['/model/{author}/{slug}'].get.operationId = 'changed';
    else if (key === 'openapi') s.openapi = '3.1.1';
    else if (key === 'version') s.info.version = 'changed';
    else
      s.paths['/model/{author}/{slug}'].get.responses['200'] = {
        content: { 'application/json': { schema: ref('Changed') } },
      };
    assert.equal(compareOfficialSingleModelSchema(s, baseline()), false);
  }
  const s = source();
  s.paths['/model/{author}/{slug}'].get.responses['200'] = {
    $ref: '#/components/responses/Private',
  };
  invalidSource(s);
});
test('annotations, ordering, unrelated operations and unselected metadata bodies remain outside this guard', () => {
  const s = source();
  s.paths['/model/{author}/{slug}'].parameters = [];
  s.paths['/model/{author}/{slug}'].get.parameters.reverse();
  for (const p of s.paths['/model/{author}/{slug}'].get.parameters) {
    Object.assign(p, { description: 'editorial', example: 'editorial' });
    Object.assign(p.schema as object, { title: 'editorial', examples: ['editorial'] });
  }
  Object.assign(s.components.schemas.ModelResponse ?? {}, { description: 'editorial' });
  s.components.schemas.PublicPricing = { type: 'boolean' };
  Object.assign(s.paths, { '/models': { private: true } });
  Object.assign(s.paths['/model/{author}/{slug}'].get.responses, { '500': { private: true } });
  assert.equal(compareOfficialSingleModelSchema(s, baseline()), true);
});
test('annotation-named properties and literal defaults, consts, enums and extensions remain structural', () => {
  const literal = { description: 'literal', title: 'literal', examples: { $comment: 'literal' } };
  for (const key of ['default', 'const', 'enum', 'x-literal']) {
    const s = source();
    Object.assign(s.components.schemas.ModelResponse ?? {}, {
      [key]: key === 'enum' ? [literal] : literal,
    });
    const projected = projectOfficialSingleModelSchema(s).definitions.ModelResponse as Record<
      string,
      unknown
    >;
    assert.deepEqual(projected[key], key === 'enum' ? [literal] : literal);
    assert.equal(compareOfficialSingleModelSchema(s, baseline()), false);
  }
  const s = source();
  Object.assign(s.components.schemas.Model ?? {}, {
    properties: { description: { type: 'string' } },
  });
  assert.equal(compareOfficialSingleModelSchema(s, baseline()), false);
});
test('malformed selected containers, nonfinite data and excess depth fail privately', () => {
  for (const bad of [null, [], 'private', 0]) {
    for (const part of [
      'paths',
      'operation',
      'parameters',
      'inherited',
      'responses',
      'response',
      'content',
      'media',
      'root',
      'components',
      'schemas',
    ]) {
      const s = source();
      const path = s.paths['/model/{author}/{slug}'];
      const op = path.get;
      if (part === 'paths') Reflect.set(s, 'paths', bad);
      else if (part === 'operation') Reflect.set(path, 'get', bad);
      else if (part === 'parameters') Reflect.set(op, 'parameters', bad);
      else if (part === 'inherited')
        Reflect.set(path, 'parameters', Array.isArray(bad) ? [null] : bad);
      else if (part === 'responses') Reflect.set(op, 'responses', bad);
      else if (part === 'response') Reflect.set(op.responses, '200', bad);
      else if (part === 'content') op.responses['200'] = { content: bad };
      else if (part === 'media') op.responses['200'] = { content: { 'application/json': bad } };
      else if (part === 'root')
        op.responses['200'] = { content: { 'application/json': { schema: bad } } };
      else if (part === 'components') Reflect.set(s, 'components', bad);
      else Reflect.set(s.components, 'schemas', bad);
      invalidSource(s);
    }
  }
  const nonfinite = source();
  Object.assign(nonfinite.components.schemas.Model ?? {}, { maximum: Infinity });
  invalidSource(nonfinite);
  const deep = source();
  let node = deep.components.schemas.Model ?? {};
  for (let i = 0; i < 70; i++) {
    const next = {};
    node.child = next;
    node = next;
  }
  invalidSource(deep);
});
test('pin envelope, provenance, stale versions and rehashed malformed or extra maps reject', () => {
  for (const patch of [
    { version: 0 },
    { version: 2 },
    { source: 'https://example.invalid/private' },
    { retrievedAt: '2026-02-30' },
    { sourceSha256: 'private' },
    { projectionSha256: '0'.repeat(64) },
    { extra: true },
  ])
    invalidPin({ ...pin, ...patch });
  for (const patch of [
    { path: '/models' },
    { method: 'post' },
    { operationId: 'private' },
    { status: '201' },
    { mediaType: 'text/plain' },
    { openapi: '3.0.0' },
    { schema: ref('Other') },
    { extra: true },
  ])
    invalidPin(rehashed({ ...pin.projection, ...patch }));
  for (const key of ['parameters', 'definitions']) {
    for (const value of [undefined, null, [], { Extra: { type: 'object' } }]) {
      const p = structuredClone(pin.projection);
      if (value === undefined) delete p[key];
      else p[key] = value;
      invalidPin(rehashed(p));
    }
    const p = structuredClone(pin.projection);
    p[key].Extra = { type: 'object' };
    invalidPin(rehashed(p));
  }
  for (const name of ['author', 'slug']) {
    const p = structuredClone(pin.projection);
    delete p.parameters[name];
    invalidPin(rehashed(p));
    const bad = structuredClone(pin.projection);
    bad.parameters[name].required = false;
    invalidPin(rehashed(bad));
  }
  const annotation = structuredClone(pin.projection);
  annotation.definitions.Model.description = 'private';
  invalidPin(rehashed(annotation));
});
