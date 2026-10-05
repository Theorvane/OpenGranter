import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  compareOfficialModelQuerySchema,
  projectOfficialModelQuerySchema,
  validateModelQuerySchemaPin,
} from '../scripts/openrouter-model-query-schema.ts';
import { canonicalSchema } from '../scripts/openrouter-schema.ts';

const pin = JSON.parse(
  await readFile(
    new URL('../contracts/openrouter-model-query-schema.json', import.meta.url),
    'utf8',
  ),
);
const shapes: Record<string, Record<string, unknown>> = {
  offset: { default: 0, minimum: 0, type: ['integer', 'null'] },
  limit: { default: 500, maximum: 1000, minimum: 1, type: 'integer' },
  output_modalities: { type: 'string' },
  supported_parameters: { type: 'string' },
  context: { minimum: 1, type: 'integer' },
  input_modalities: { type: 'string' },
  q: { type: 'string' },
  sort: {
    type: 'string',
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
    'x-speakeasy-unknown-values': 'allow',
  },
};
function source() {
  const parameters: {
    name: string;
    in: string;
    required: boolean;
    description: string;
    schema: Record<string, unknown>;
  }[] = Object.entries(shapes).map(([name, schema]) => ({
    name,
    in: 'query',
    required: false,
    description: 'editorial',
    schema: { ...structuredClone(schema), description: 'editorial', example: 12 },
  }));
  const inherited: Record<string, unknown>[] = [{ $ref: '#/components/parameters/AppIdentifier' }];
  return {
    openapi: '3.1.0',
    info: { version: '1.0.0' },
    paths: {
      '/models': {
        parameters: inherited,
        get: { operationId: 'getModels', parameters },
      },
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
function parameter(data: ReturnType<typeof source>, name = 'context') {
  const found = data.paths['/models'].get.parameters.find((p) => p.name === name);
  assert.ok(found);
  return found;
}
function invalidSource(data: unknown) {
  assert.throws(() => projectOfficialModelQuerySchema(data), {
    message: 'Invalid official model-query schema',
  });
}

test('model-query pin reflects independent official inline shapes without prose or runtime constraints', () => {
  const p = projectOfficialModelQuerySchema(source());
  assert.deepEqual(p, {
    openapi: '3.1.0',
    documentVersion: '1.0.0',
    path: '/models',
    method: 'get',
    operationId: 'getModels',
    parameters: Object.fromEntries(
      Object.entries(shapes).map(([name, schema]) => [
        name,
        { name, in: 'query', required: false, schema },
      ]),
    ),
  });
  assert.equal(pin.version, 2);
  assert.deepEqual(validateModelQuerySchemaPin(pin).projection, p);
  assert.equal(compareOfficialModelQuerySchema(source(), pin), true);
});

const changes: [string, string, string, unknown][] = [
  ['nullable offset', 'offset', 'type', 'integer'],
  ['offset minimum', 'offset', 'minimum', 1],
  ['offset default', 'offset', 'default', 1],
  ['limit type', 'limit', 'type', 'number'],
  ['limit minimum', 'limit', 'minimum', 0],
  ['limit maximum', 'limit', 'maximum', 2000],
  ['limit default', 'limit', 'default', 1000],
  ['modality nullable', 'output_modalities', 'type', ['string', 'null']],
  ['modality new enum', 'output_modalities', 'enum', ['text', 'all']],
  ['modality structural default', 'output_modalities', 'default', 'text'],
  ['parameter array', 'supported_parameters', 'type', 'array'],
  ['parameter length', 'supported_parameters', 'maxLength', 128],
  ['parameter extension', 'supported_parameters', 'x-speakeasy-unknown-values', 'allow'],
  ['context minimum', 'context', 'minimum', 0],
  ['context maximum', 'context', 'maximum', 100000],
  ['context default', 'context', 'default', 8192],
  ['context reference', 'context', '$ref', '#/components/schemas/ModelContext'],
  ['input nullable', 'input_modalities', 'type', ['string', 'null']],
  ['input enum', 'input_modalities', 'enum', ['text', 'image']],
  ['query length', 'q', 'maxLength', 256],
  ['query default', 'q', 'default', 'text'],
  ['sort enum', 'sort', 'enum', ['newest']],
  ['sort extension', 'sort', 'x-speakeasy-unknown-values', 'deny'],
];
for (const [name, field, key, value] of changes)
  test(`selected ${name} detects model-query structural drift`, () => {
    const data = source();
    parameter(data, field).schema[key] = value;
    assert.equal(compareOfficialModelQuerySchema(data, pin), false);
  });
for (const [key, value] of [
  ['style', 'form'],
  ['explode', true],
  ['allowEmptyValue', true],
  ['required', true],
  ['x-client-extension', { enabled: true }],
] as const)
  test(`selected parameter ${key} remains structural`, () => {
    const data = source();
    Object.assign(parameter(data), { [key]: value });
    assert.equal(compareOfficialModelQuerySchema(data, pin), false);
  });
test('explicit optional required removal remains a structural change', () => {
  const data = source();
  Reflect.deleteProperty(parameter(data), 'required');
  assert.equal(compareOfficialModelQuerySchema(data, pin), false);
});
for (const part of ['openapi', 'version', 'operationId'] as const)
  test(`model-query ${part} identity changes detect drift`, () => {
    const data = source();
    if (part === 'openapi') data.openapi = '3.1.1';
    else if (part === 'version') data.info.version = '2.0.0';
    else data.paths['/models'].get.operationId = 'listModels';
    assert.equal(compareOfficialModelQuerySchema(data, pin), false);
  });
test('parameter order, editorial annotations and unselected structures are ignored', () => {
  const data = source();
  data.paths['/models'].get.parameters.reverse();
  for (const p of data.paths['/models'].get.parameters) {
    Object.assign(p, {
      title: 'editorial',
      example: 'private editorial',
      externalDocs: { url: 'https://example.invalid' },
    });
    Object.assign(p.schema, {
      description: 'new prose',
      examples: ['editorial'],
      $comment: 'editorial',
    });
  }
  data.paths['/models'].get.parameters.push({
    name: 'category',
    in: 'query',
    required: true,
    description: 'unselected',
    schema: { enum: ['unselected'] },
  });
  Object.assign(data.paths['/models'].get, {
    summary: 'edited',
    'x-speakeasy-pagination': { changed: true },
  });
  Object.assign(data.paths, { '/other': { get: {} } });
  assert.equal(compareOfficialModelQuerySchema(data, pin), true);
});
test('annotation-named schema properties and literal default/const/enum data remain structural', () => {
  for (const key of ['description', 'title', 'example', 'examples', 'externalDocs', '$comment']) {
    for (const container of ['properties', 'default', 'const', 'enum']) {
      const data = source();
      parameter(data).schema[container] =
        container === 'enum'
          ? [{ [key]: 'literal' }]
          : { [key]: container === 'properties' ? { type: 'string' } : 'literal' };
      assert.equal(compareOfficialModelQuerySchema(data, pin), false);
    }
  }
});
for (const name of Object.keys(shapes)) {
  test(`model-query missing/duplicate/malformed ${name} rejects safely`, () => {
    const missing = source();
    missing.paths['/models'].get.parameters = missing.paths['/models'].get.parameters.filter(
      (p) => p.name !== name,
    );
    invalidSource(missing);
    const duplicate = source();
    duplicate.paths['/models'].get.parameters.push(structuredClone(parameter(duplicate, name)));
    invalidSource(duplicate);
    for (const value of [null, [], 'private schema content', undefined]) {
      const data = source();
      Object.assign(parameter(data, name), { schema: value });
      invalidSource(data);
    }
    for (const patch of [
      { in: 'header' },
      { required: 'private invalid' },
      { $ref: '#/components/parameters/Context' },
      { content: { 'application/json': {} } },
    ]) {
      const data = source();
      Object.assign(parameter(data, name), patch);
      invalidSource(data);
    }
    const inherited = source();
    inherited.paths['/models'].parameters.push(parameter(inherited, name));
    invalidSource(inherited);
  });
}
test('missing/malformed model-query source containers fail with fixed content-free errors', () => {
  for (const data of [
    null,
    {},
    { paths: {} },
    { ...source(), info: [] },
    { ...source(), paths: { '/models': { get: null } } },
    { ...source(), paths: { '/models': { get: { operationId: 'getModels', parameters: null } } } },
  ])
    invalidSource(data);
  const badEntry = source();
  badEntry.paths['/models'].get.parameters.push(null as unknown as ReturnType<typeof parameter>);
  invalidSource(badEntry);
  const deep = source();
  let nested: Record<string, unknown> = parameter(deep).schema;
  for (let i = 0; i < 70; i++) {
    const next = {};
    nested.child = next;
    nested = next;
  }
  invalidSource(deep);
});
test('model-query pin rejects invalid envelope provenance/digests/version without private errors', () => {
  for (const patch of [
    { version: 0 },
    { version: 1 },
    { source: 'https://example.invalid/private' },
    { retrievedAt: '2026-02-30' },
    { sourceSha256: 'private source' },
    { projectionSha256: '0'.repeat(64) },
    { extra: true },
  ]) {
    assert.throws(() => validateModelQuerySchemaPin({ ...pin, ...patch }), {
      message: 'Invalid model-query schema pin',
    });
  }
});
test('model-query rehashed missing/extra/malformed exact maps and identities reject', () => {
  for (const name of Object.keys(shapes)) {
    const missing = structuredClone(pin.projection);
    delete missing.parameters[name];
    assert.throws(() => validateModelQuerySchemaPin(rehashed(missing)), {
      message: 'Invalid model-query schema pin',
    });
    for (const value of [null, [], 'private parameter']) {
      const bad = structuredClone(pin.projection);
      bad.parameters[name] = value;
      assert.throws(() => validateModelQuerySchemaPin(rehashed(bad)), {
        message: 'Invalid model-query schema pin',
      });
    }
  }
  for (const patch of [
    { extra: true },
    { path: '/private' },
    { method: 'post' },
    { operationId: 'privateOperation' },
  ]) {
    assert.throws(() => validateModelQuerySchemaPin(rehashed({ ...pin.projection, ...patch })), {
      message: 'Invalid model-query schema pin',
    });
  }
  const extra = structuredClone(pin.projection);
  extra.parameters.category = {};
  assert.throws(() => validateModelQuerySchemaPin(rehashed(extra)), {
    message: 'Invalid model-query schema pin',
  });
  const annotations = structuredClone(pin.projection);
  annotations.parameters.context.schema.description = 'editorial';
  assert.throws(() => validateModelQuerySchemaPin(rehashed(annotations)), {
    message: 'Invalid model-query schema pin',
  });
});

test('model-query vendor extension objects keep annotation-named literal data structural', () => {
  const data = source();
  const baseline = source();
  Object.assign(parameter(data), {
    'x-client-extension': { description: 'changed literal', examples: { title: 'literal' } },
  });
  Object.assign(parameter(baseline), {
    'x-client-extension': { description: 'original literal', examples: { title: 'literal' } },
  });
  assert.notEqual(
    canonicalSchema(projectOfficialModelQuerySchema(data)),
    canonicalSchema(projectOfficialModelQuerySchema(baseline)),
  );
  assert.deepEqual(
    (projectOfficialModelQuerySchema(data).parameters.context as Record<string, unknown>)[
      'x-client-extension'
    ],
    { description: 'changed literal', examples: { title: 'literal' } },
  );
});

test('discovery query version2 removal reproduces the reviewed version1 projection digest', () => {
  const p = structuredClone(pin.projection);
  for (const name of ['input_modalities', 'q', 'sort']) delete p.parameters[name];
  assert.equal(
    createHash('sha256').update(canonicalSchema(p)).digest('hex'),
    'daa5d309dfc66e8b404f50fb06a64ab4d7e244de8a7f68f78f943a9f94ee4c7a',
  );
});
