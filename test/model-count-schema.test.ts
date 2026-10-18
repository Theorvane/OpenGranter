import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  compareOfficialModelCountSchema,
  projectOfficialModelCountSchema,
  validateModelCountSchemaPin,
} from '../scripts/openrouter-model-count-schema.ts';
import { canonicalSchema } from '../scripts/openrouter-schema.ts';

const pin = JSON.parse(
  await readFile(
    new URL('../contracts/openrouter-model-count-schema.json', import.meta.url),
    'utf8',
  ),
);
const countShape = { type: 'integer' };
const dataShape = { type: 'object', required: ['count'], properties: { count: countShape } };
const responseShape = { type: 'object', required: ['data'], properties: { data: dataShape } };
function source() {
  return {
    openapi: '3.1.0',
    info: { version: '1.0.0' },
    paths: {
      '/models/count': {
        parameters: [{ $ref: '#/components/parameters/AppIdentifier' }] as Record<
          string,
          unknown
        >[],
        get: {
          operationId: 'listModelsCount',
          parameters: [
            { name: 'output_modalities', in: 'query', required: false, schema: { type: 'string' } },
          ] as Record<string, unknown>[],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ModelsCountResponse' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: { ModelsCountResponse: structuredClone(responseShape) as Record<string, unknown> },
    },
  };
}
function parameter(data: ReturnType<typeof source>) {
  const entry = data.paths['/models/count'].get.parameters[0];
  assert.ok(entry);
  return entry;
}
function rehashed(projection: unknown) {
  return {
    ...pin,
    projection,
    projectionSha256: createHash('sha256').update(canonicalSchema(projection)).digest('hex'),
  };
}
function invalidSource(data: unknown) {
  assert.throws(() => projectOfficialModelCountSchema(data), {
    name: 'TypeError',
    message: 'Invalid official model-count schema',
  });
}
function invalidPin(data: unknown) {
  assert.throws(() => validateModelCountSchemaPin(data), {
    name: 'TypeError',
    message: 'Invalid model-count schema pin',
  });
}
test('count pin matches independently specified official query and nested count shapes', () => {
  const expected = {
    openapi: '3.1.0',
    documentVersion: '1.0.0',
    path: '/models/count',
    method: 'get',
    operationId: 'listModelsCount',
    parameters: {
      output_modalities: {
        name: 'output_modalities',
        in: 'query',
        required: false,
        schema: { type: 'string' },
      },
    },
    status: '200',
    mediaType: 'application/json',
    schema: { $ref: '#/components/schemas/ModelsCountResponse' },
    definitions: { ModelsCountResponse: responseShape },
  };
  assert.equal(pin.version, 1);
  assert.deepEqual(projectOfficialModelCountSchema(source()), expected);
  assert.deepEqual(validateModelCountSchemaPin(pin).projection, expected);
  assert.equal(compareOfficialModelCountSchema(source(), pin), true);
});
for (const [key, value] of [
  ['type', ['string', 'null']],
  ['enum', ['text', 'all']],
  ['default', 'text'],
  ['maxLength', 128],
  ['x-speakeasy-unknown-values', 'allow'],
] as const)
  test(`count parameter ${key} detects structural drift`, () => {
    const data = source();
    Object.assign(parameter(data).schema as object, { [key]: value });
    assert.equal(compareOfficialModelCountSchema(data, pin), false);
  });
for (const [key, value] of [
  ['required', true],
  ['style', 'form'],
  ['explode', true],
  ['allowEmptyValue', true],
  ['x-count', { description: 'literal' }],
] as const)
  test(`count serialization ${key} remains structural`, () => {
    const data = source();
    Object.assign(parameter(data), { [key]: value });
    assert.equal(compareOfficialModelCountSchema(data, pin), false);
  });
test('removal of explicit optional status is structural', () => {
  const data = source();
  Reflect.deleteProperty(parameter(data), 'required');
  assert.equal(compareOfficialModelCountSchema(data, pin), false);
});
for (const [name, shape] of [
  ['root type', { ...responseShape, type: ['object', 'null'] }],
  ['root required', { ...responseShape, required: [] }],
  ['data required', { ...responseShape, properties: { data: { ...dataShape, required: [] } } }],
  [
    'count type',
    {
      ...responseShape,
      properties: { data: { ...dataShape, properties: { count: { type: 'number' } } } },
    },
  ],
  [
    'count nullable',
    {
      ...responseShape,
      properties: { data: { ...dataShape, properties: { count: { type: ['integer', 'null'] } } } },
    },
  ],
  [
    'count lower bound',
    {
      ...responseShape,
      properties: { data: { ...dataShape, properties: { count: { ...countShape, minimum: 0 } } } },
    },
  ],
  [
    'data reference',
    { ...responseShape, properties: { data: { $ref: '#/components/schemas/FutureCount' } } },
  ],
  ['additional properties', { ...responseShape, additionalProperties: false }],
  ['vendor data', { ...responseShape, 'x-count': { description: 'literal' } }],
] as const)
  test(`count response ${name} detects drift`, () => {
    const data = source();
    data.components.schemas.ModelsCountResponse = structuredClone(shape);
    assert.equal(compareOfficialModelCountSchema(data, pin), false);
  });
for (const part of ['openapi', 'version', 'operationId', 'responseRef'] as const)
  test(`count ${part} identity drift is detected`, () => {
    const data = source();
    if (part === 'openapi') data.openapi = '3.1.1';
    else if (part === 'version') data.info.version = '2.0.0';
    else if (part === 'operationId') data.paths['/models/count'].get.operationId = 'countModels';
    else
      data.paths['/models/count'].get.responses['200'].content['application/json'].schema.$ref =
        '#/components/schemas/FutureCount';
    assert.equal(compareOfficialModelCountSchema(data, pin), false);
  });
test('editorial changes, unrelated fields and parameter order do not change selected count structures', () => {
  const data = source();
  Object.assign(parameter(data), { description: 'editorial', example: 'text', title: 'editorial' });
  Object.assign(parameter(data).schema as object, { description: 'new prose', examples: ['text'] });
  Object.assign(data.components.schemas.ModelsCountResponse, {
    description: 'new prose',
    example: { data: { count: 12 } },
  });
  data.paths['/models/count'].get.parameters.push({
    name: 'unselected',
    in: 'query',
    required: true,
    schema: { type: 'integer' },
  });
  data.paths['/models/count'].get.parameters.reverse();
  Object.assign(data.paths, { '/unselected': { get: {} } });
  Object.assign(data.components.schemas, { FutureCount: { type: 'string' } });
  assert.equal(compareOfficialModelCountSchema(data, pin), true);
});
for (const key of ['description', 'title', 'example', 'examples', 'externalDocs', '$comment'])
  test(`annotation-named ${key} literals and properties remain structural`, () => {
    for (const container of ['properties', 'default', 'const', 'enum', 'x-count']) {
      const data = source();
      const literal = { [key]: container === 'properties' ? { type: 'string' } : 'literal' };
      data.components.schemas.ModelsCountResponse[container] =
        container === 'enum' ? [literal] : literal;
      assert.equal(compareOfficialModelCountSchema(data, pin), false);
    }
  });
test('count source rejects missing, duplicate, malformed and inherited selected parameters privately', () => {
  const missing = source();
  missing.paths['/models/count'].get.parameters = [];
  invalidSource(missing);
  const duplicate = source();
  duplicate.paths['/models/count'].get.parameters.push(structuredClone(parameter(duplicate)));
  invalidSource(duplicate);
  for (const value of [null, [], 'private-source', undefined, {}]) {
    const data = source();
    Object.assign(parameter(data), { schema: value });
    invalidSource(data);
  }
  for (const patch of [
    { in: 'header' },
    { required: 'private-source' },
    { $ref: '#/components/parameters/Count' },
    { content: { 'application/json': {} } },
  ]) {
    const data = source();
    Object.assign(parameter(data), patch);
    invalidSource(data);
  }
  const inherited = source();
  inherited.paths['/models/count'].parameters.push(parameter(inherited));
  invalidSource(inherited);
});
test('count source rejects invalid response/definition and outer containers privately', () => {
  for (const value of [null, {}, [], 'private-source', { paths: {} }]) invalidSource(value);
  for (const value of [null, {}, [], 'private-source', { $ref: 1 }]) {
    const data = source();
    Object.assign(data.components.schemas, { ModelsCountResponse: value });
    invalidSource(data);
    const response = source();
    Object.assign(
      response.paths['/models/count'].get.responses['200'].content['application/json'],
      { schema: value },
    );
    invalidSource(response);
  }
  const ref = source();
  Object.assign(ref.paths['/models/count'].get.responses['200'], {
    $ref: '#/components/responses/Count',
  });
  invalidSource(ref);
  const deep = source();
  let current = deep.components.schemas.ModelsCountResponse;
  for (let index = 0; index < 70; index++) {
    const next = {};
    current.child = next;
    current = next;
  }
  invalidSource(deep);
});
test('count pin rejects stale/invalid provenance without exposing data', () => {
  for (const patch of [
    { version: 0 },
    { version: 2 },
    { source: 'https://private-source.example' },
    { retrievedAt: '2026-02-30' },
    { sourceSha256: 'private-source' },
    { projectionSha256: '0'.repeat(64) },
    { extra: true },
  ])
    invalidPin({ ...pin, ...patch });
});
test('rehashed count pin exact maps, identities and normalization remain guarded', () => {
  for (const patch of [
    { extra: true },
    { openapi: '3.1.1' },
    { operationId: 'countModels' },
    { path: '/private-source' },
    { method: 'post' },
    { status: '201' },
    { mediaType: 'text/plain' },
    { schema: { $ref: '#/components/schemas/FutureCount' } },
    { definitions: {} },
    { parameters: {} },
  ])
    invalidPin(rehashed({ ...pin.projection, ...patch }));
  for (const section of ['parameters', 'definitions']) {
    const data = structuredClone(pin.projection);
    data[section].extra = {};
    invalidPin(rehashed(data));
  }
  const annotation = structuredClone(pin.projection);
  annotation.definitions.ModelsCountResponse.description = 'editorial';
  invalidPin(rehashed(annotation));
});
