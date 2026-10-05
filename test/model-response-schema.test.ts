import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  compareOfficialModelResponseSchema,
  projectOfficialModelResponseSchema,
  validateModelResponseSchemaPin,
} from '../scripts/openrouter-model-response-schema.ts';
import { canonicalSchema } from '../scripts/openrouter-schema.ts';

const pin = JSON.parse(
  await readFile(
    new URL('../contracts/openrouter-model-response-schema.json', import.meta.url),
    'utf8',
  ),
);
const names = [
  'ModelsListResponse',
  'ModelsListResponseData',
  'Model',
  'ModelAliasTarget',
  'ModelArchitecture',
  'InputModality',
  'InstructType',
  'OutputModality',
  'ModelGroup',
  'ModelBenchmarks',
  'AABenchmarkEntry',
  'DABenchmarkEntry',
  'DefaultParameters',
  'ModelLinks',
  'PerRequestLimits',
  'PublicPricing',
  'PricingOverride',
  'ModelReasoning',
  'ReasoningEffort',
  'Parameter',
  'TopProviderInfo',
];
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
function source() {
  const schemas: Record<string, Record<string, unknown>> = Object.fromEntries(
    names.map((name) => [name, { type: 'object', properties: { value: { type: 'string' } } }]),
  );
  schemas.ModelsListResponse = {
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
  };
  schemas.ModelsListResponseData = { type: 'array', items: ref('Model') };
  schemas.Model = {
    type: 'object',
    required: ['id', 'context_length', 'architecture', 'pricing'],
    properties: {
      id: { type: 'string' },
      description: { type: 'string', description: 'editorial' },
      context_length: { type: ['integer', 'null'] },
      architecture: ref('ModelArchitecture'),
      pricing: ref('PublicPricing'),
    },
  };
  schemas.ModelArchitecture = {
    type: 'object',
    properties: {
      input_modalities: { type: 'array', items: ref('InputModality') },
      output_modalities: { type: 'array', items: ref('OutputModality') },
    },
  };
  schemas.InputModality = {
    type: 'string',
    enum: ['text', 'image', 'audio', 'file'],
    'x-speakeasy-unknown-values': 'allow',
  };
  schemas.OutputModality = { type: 'string', enum: ['text', 'image', 'audio'] };
  schemas.PublicPricing = {
    type: 'object',
    required: ['prompt', 'completion'],
    properties: {
      prompt: { type: 'string' },
      completion: { type: 'string' },
      overrides: { type: 'array', items: ref('PricingOverride') },
    },
  };
  schemas.DefaultParameters = {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: { temperature: { type: ['number', 'null'], format: 'double', nullable: true } },
  };
  const schema: Record<string, unknown> = ref('ModelsListResponse');
  const response: Record<string, unknown> = {
    content: { 'application/json': { schema } },
    description: 'editorial',
  };
  return {
    openapi: '3.1.0',
    info: { version: '1.0.0' },
    paths: { '/models': { get: { operationId: 'getModels', responses: { '200': response } } } },
    components: { schemas },
  };
}
function hashed(value: unknown) {
  return createHash('sha256').update(canonicalSchema(value)).digest('hex');
}
function rehashed(projection: unknown) {
  return { ...pin, projection, projectionSha256: hashed(projection) };
}
function baseline() {
  return rehashed(projectOfficialModelResponseSchema(source()));
}
function invalidSource(value: unknown) {
  assert.throws(() => projectOfficialModelResponseSchema(value), {
    message: 'Invalid official model-response schema',
  });
}
function invalidPin(value: unknown) {
  assert.throws(() => validateModelResponseSchemaPin(value), {
    message: 'Invalid model-response schema pin',
  });
}

test('response projection captures fixed operation, JSON success schema and exact selected definitions', () => {
  const s = source();
  const p = projectOfficialModelResponseSchema(s);
  assert.equal(p.openapi, '3.1.0');
  assert.equal(p.documentVersion, '1.0.0');
  assert.equal(p.path, '/models');
  assert.equal(p.method, 'get');
  assert.equal(p.operationId, 'getModels');
  assert.equal(p.status, '200');
  assert.equal(p.mediaType, 'application/json');
  assert.deepEqual(p.schema, ref('ModelsListResponse'));
  assert.deepEqual(Object.keys(p.definitions).sort(), [...names].sort());
  assert.deepEqual(p.definitions.Model, {
    ...s.components.schemas.Model,
    properties: {
      ...(s.components.schemas.Model?.properties as object),
      description: { type: 'string' },
    },
  });
  assert.equal(compareOfficialModelResponseSchema(s, baseline()), true);
  assert.deepEqual(validateModelResponseSchemaPin(pin).projection, pin.projection);
  assert.equal(pin.version, 1);
  assert.deepEqual(pin.projection.schema, ref('ModelsListResponse'));
  assert.deepEqual(pin.projection.definitions.ModelsListResponse.required, [
    'data',
    'total_count',
    'links',
  ]);
  assert.deepEqual(pin.projection.definitions.Model.properties.context_length, {
    type: ['integer', 'null'],
  });
  assert.deepEqual(pin.projection.definitions.PublicPricing.required, ['prompt', 'completion']);
  assert.deepEqual(pin.projection.definitions.InputModality.enum, [
    'text',
    'image',
    'file',
    'audio',
    'video',
  ]);
  assert.equal(Object.hasOwn(pin.projection.definitions.Model.properties, 'description'), true);
});
for (const name of names) {
  test(`nested ${name} structural change detects drift with unchanged parent refs`, () => {
    const s = source();
    Object.assign(s.components.schemas[name] ?? {}, {
      'x-contract-change': { description: 'literal' },
    });
    assert.equal(compareOfficialModelResponseSchema(s, baseline()), false);
  });
  test(`missing or malformed selected ${name} source and rehashed pin fail safely`, () => {
    for (const bad of [undefined, null, [], 'private source', {}]) {
      const s = source();
      if (bad === undefined) Reflect.deleteProperty(s.components.schemas, name);
      else Reflect.set(s.components.schemas, name, bad);
      invalidSource(s);
      const p = structuredClone(pin.projection);
      if (bad === undefined) Reflect.deleteProperty(p.definitions, name);
      else Reflect.set(p.definitions, name, bad);
      invalidPin(rehashed(p));
    }
  });
}
for (const [name, patch] of [
  ['required', { required: ['id'] }],
  ['nullability', { type: 'string' }],
  ['bounds', { minLength: 1, maxLength: 256 }],
  ['enum', { enum: ['changed'] }],
  ['reference', ref('FutureModel')],
  ['default', { default: { description: 'literal' } }],
  ['format', { format: 'int64' }],
  ['additional properties', { additionalProperties: false }],
  [
    'extension',
    { 'x-client-extension': { description: 'literal', examples: { title: 'literal' } } },
  ],
] as const)
  test(`selected model response ${name} remains structural`, () => {
    const s = source();
    Object.assign(s.components.schemas.Model ?? {}, patch);
    assert.equal(compareOfficialModelResponseSchema(s, baseline()), false);
  });
test('root response reference or inline structure change is detected without following URLs', () => {
  for (const schema of [
    ref('FutureModel'),
    { $ref: 'https://example.invalid/private' },
    { type: 'object', properties: { data: { type: 'array' } } },
  ]) {
    const s = source();
    s.paths['/models'].get.responses['200'].content = { 'application/json': { schema } };
    assert.equal(compareOfficialModelResponseSchema(s, baseline()), false);
  }
});
test('editorial changes and unrelated operations, schemas, status, media and headers stay outside selection', () => {
  const s = source();
  for (const schema of Object.values(s.components.schemas))
    Object.assign(schema, {
      description: 'new prose',
      title: 'title',
      examples: ['example'],
      externalDocs: { url: 'https://example.invalid' },
      $comment: 'comment',
    });
  Object.assign(s.components.schemas, { Unrelated: null });
  Object.assign(s.paths, { '/other': { get: null } });
  Object.assign(s.paths['/models'].get.responses, { '500': { private: true } });
  Object.assign(s.paths['/models'].get.responses['200'], {
    headers: { private: true },
    description: 'new response prose',
  });
  const content = s.paths['/models'].get.responses['200'].content as Record<string, unknown>;
  content['text/event-stream'] = { private: true };
  assert.equal(compareOfficialModelResponseSchema(s, baseline()), true);
});
test('annotation-named properties and literal default/const/enum/extension data survive normalization', () => {
  for (const key of ['description', 'title', 'example', 'examples', 'externalDocs', '$comment']) {
    for (const container of ['properties', 'default', 'const', 'enum', 'x-literal']) {
      const s = source();
      Reflect.set(
        s.components.schemas.Model ?? {},
        container,
        container === 'enum'
          ? [{ [key]: 'literal' }]
          : { [key]: container === 'properties' ? { type: 'boolean' } : 'literal' },
      );
      assert.equal(compareOfficialModelResponseSchema(s, baseline()), false);
    }
  }
});
for (const identity of ['openapi', 'documentVersion', 'operationId'])
  test(`response ${identity} drift is detected`, () => {
    const s = source();
    if (identity === 'openapi') s.openapi = '3.1.1';
    else if (identity === 'documentVersion') s.info.version = '2.0.0';
    else s.paths['/models'].get.operationId = 'getFutureModels';
    assert.equal(compareOfficialModelResponseSchema(s, baseline()), false);
  });
test('missing or malformed response source containers expose fixed errors', () => {
  for (const s of [
    null,
    {},
    { ...source(), info: [] },
    { ...source(), paths: {} },
    { ...source(), components: null },
  ])
    invalidSource(s);
  for (const bad of [undefined, null, [], 'private schema', {}]) {
    const s = source();
    s.paths['/models'].get.responses['200'].content = { 'application/json': { schema: bad } };
    invalidSource(s);
  }
  for (const bad of [null, [], '', 12]) {
    const s = source();
    s.paths['/models'].get.responses['200'].content = {
      'application/json': { schema: { $ref: bad } },
    };
    invalidSource(s);
  }
  const responseReference = source();
  responseReference.paths['/models'].get.responses['200'].$ref =
    '#/components/responses/FutureResponse';
  invalidSource(responseReference);
  for (const content of [
    undefined,
    null,
    [],
    {},
    { 'application/xml': { schema: ref('ModelsListResponse') } },
  ]) {
    const s = source();
    s.paths['/models'].get.responses['200'].content = content;
    invalidSource(s);
  }
  const deep = source();
  let node = deep.components.schemas.Model ?? {};
  for (let i = 0; i < 70; i++) {
    const child = {};
    node.child = child;
    node = child;
  }
  invalidSource(deep);
  const nonfinite = source();
  Object.assign(nonfinite.components.schemas.Model ?? {}, { maximum: Infinity });
  invalidSource(nonfinite);
});
test('invalid pin envelope, provenance, dates, hashes and stale versions reject', () => {
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
});
test('rehashed invalid projection maps, identity, schema and unnormalized data reject', () => {
  for (const patch of [
    { path: '/other' },
    { method: 'post' },
    { status: '201' },
    { mediaType: 'application/xml' },
    { operationId: 'private' },
    { openapi: '3.0.0' },
    { extra: true },
    { schema: ref('Other') },
  ])
    invalidPin(rehashed({ ...pin.projection, ...patch }));
  const extra = structuredClone(pin.projection);
  extra.definitions.FutureModel = { type: 'object' };
  invalidPin(rehashed(extra));
  const annotation = structuredClone(pin.projection);
  annotation.definitions.Model.description = 'private annotation';
  invalidPin(rehashed(annotation));
  for (const key of ['schema', 'definitions']) {
    const p = structuredClone(pin.projection);
    delete p[key];
    invalidPin(rehashed(p));
  }
});
