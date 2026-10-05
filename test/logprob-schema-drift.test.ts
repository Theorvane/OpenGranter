import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  canonicalSchema,
  compareOfficialSchema,
  projectOfficialSchema,
  validateSchemaPin,
} from '../scripts/openrouter-schema.ts';

const pinned = JSON.parse(
  await readFile(new URL('../contracts/openrouter-request-schema.json', import.meta.url), 'utf8'),
);
const requestShapes = {
  logprobs: { type: ['boolean', 'null'] },
  top_logprobs: { type: ['integer', 'null'] },
};
const scalar = {
  token: { type: 'string' },
  logprob: { format: 'double', type: 'number' },
  bytes: { type: ['array', 'null'], items: { type: 'integer' } },
};
const probabilityShapes = {
  ChatTokenLogprob: {
    type: 'object',
    required: ['token', 'logprob', 'bytes', 'top_logprobs'],
    properties: {
      ...scalar,
      top_logprobs: {
        type: 'array',
        items: { type: 'object', required: ['token', 'logprob', 'bytes'], properties: scalar },
      },
    },
  },
  ChatTokenLogprobs: {
    type: ['object', 'null'],
    required: ['content'],
    properties: {
      content: {
        type: ['array', 'null'],
        items: { $ref: '#/components/schemas/ChatTokenLogprob' },
      },
      refusal: {
        type: ['array', 'null'],
        items: { $ref: '#/components/schemas/ChatTokenLogprob' },
      },
    },
  },
};
function source() {
  const p = pinned.projection;
  return {
    openapi: p.openapi,
    info: { version: p.documentVersion },
    paths: {
      '/chat/completions': {
        post: {
          requestBody: { content: { 'application/json': { schema: { $ref: p.requestRef } } } },
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: p.responseRef } } } },
          },
        },
      },
    },
    components: {
      schemas: structuredClone({
        ...p.definitions,
        ...p.responseDefinitions,
        ...p.streamDefinitions,
        ...p.usageDefinitions,
        ...p.reasoningDefinitions,
        ChatToolMessage: p.toolMessages.ChatToolMessage,
        ChatRequest: {
          type: 'object',
          required: p.required,
          properties: { ...p.fields, ...requestShapes },
        },
        ...probabilityShapes,
      }) as Record<string, unknown>,
    },
  };
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function set(data: unknown, path: readonly string[], value: unknown) {
  let container = object(data);
  for (const key of path.slice(0, -1)) container = object(container[key]);
  const key = path.at(-1);
  assert.ok(key);
  container[key] = value;
}
function refreshed(projection: unknown) {
  return {
    ...pinned,
    projection,
    projectionSha256: createHash('sha256').update(canonicalSchema(projection)).digest('hex'),
  };
}

test('probability projection selects exact nullable controls and full token/group definitions', () => {
  const p = projectOfficialSchema(source());
  for (const [name, shape] of Object.entries(requestShapes))
    assert.deepEqual(p.fields[name], shape);
  for (const [name, shape] of Object.entries(probabilityShapes))
    assert.equal(canonicalSchema(p.responseDefinitions[name]), canonicalSchema(shape));
  assert.equal(Object.keys(p.fields).length, 33);
  assert.deepEqual(p.fields.user, { type: 'string' });
  assert.equal(Object.keys(p.responseDefinitions).length, 5);
  assert.equal(pinned.version, 29);
  assert.equal(compareOfficialSchema(source(), pinned), true);
});

const changes: [string, string[], unknown][] = [
  ['request boolean nullability', ['ChatRequest', 'properties', 'logprobs', 'type'], ['boolean']],
  [
    'request integer type',
    ['ChatRequest', 'properties', 'top_logprobs', 'type'],
    ['number', 'null'],
  ],
  ['request new bound', ['ChatRequest', 'properties', 'top_logprobs', 'minimum'], 0],
  ['request new default', ['ChatRequest', 'properties', 'logprobs', 'default'], false],
  ['group nullability', ['ChatTokenLogprobs', 'type'], ['object']],
  ['group required refusal', ['ChatTokenLogprobs', 'required'], ['content', 'refusal']],
  [
    'content reference',
    ['ChatTokenLogprobs', 'properties', 'content', 'items', '$ref'],
    '#/components/schemas/OtherToken',
  ],
  ['refusal type', ['ChatTokenLogprobs', 'properties', 'refusal', 'type'], ['array']],
  ['refusal constraint', ['ChatTokenLogprobs', 'properties', 'refusal', 'maxItems'], 100],
  ['token required list', ['ChatTokenLogprob', 'required'], ['token', 'logprob', 'bytes']],
  ['token type', ['ChatTokenLogprob', 'properties', 'token', 'type'], ['string', 'null']],
  ['token string constraint', ['ChatTokenLogprob', 'properties', 'token', 'maxLength'], 1024],
  ['token probability format', ['ChatTokenLogprob', 'properties', 'logprob', 'format'], 'float'],
  ['token byte integer', ['ChatTokenLogprob', 'properties', 'bytes', 'items', 'type'], 'number'],
  ['token bytes nullability', ['ChatTokenLogprob', 'properties', 'bytes', 'type'], ['array']],
  [
    'alternative required list',
    ['ChatTokenLogprob', 'properties', 'top_logprobs', 'items', 'required'],
    ['token', 'logprob'],
  ],
  [
    'alternative bytes type',
    [
      'ChatTokenLogprob',
      'properties',
      'top_logprobs',
      'items',
      'properties',
      'bytes',
      'items',
      'type',
    ],
    'number',
  ],
  [
    'alternative probability type',
    ['ChatTokenLogprob', 'properties', 'top_logprobs', 'items', 'properties', 'logprob', 'type'],
    'string',
  ],
  [
    'alternative default literal',
    ['ChatTokenLogprob', 'properties', 'top_logprobs', 'items', 'default'],
    { description: 'literal data' },
  ],
  [
    'alternative extension',
    ['ChatTokenLogprob', 'properties', 'top_logprobs', 'items', 'x-source-extension'],
    true,
  ],
];
for (const [name, path, value] of changes)
  test(`probability ${name} causes drift with unchanged choice references`, () => {
    const data = source();
    set(data.components.schemas, path, value);
    assert.equal(compareOfficialSchema(data, pinned), false);
  });

test('probability editorial annotations and unrelated definitions stay equivalent', () => {
  const data = source();
  for (const name of ['ChatTokenLogprob', 'ChatTokenLogprobs'])
    Object.assign(object(data.components.schemas[name]), {
      description: 'editorial',
      examples: [{ private: 'example' }],
    });
  set(
    data.components.schemas,
    ['ChatTokenLogprob', 'properties', 'top_logprobs', 'items', 'description'],
    'editorial',
  );
  set(
    data.components.schemas,
    ['ChatRequest', 'properties', 'top_logprobs', 'description'],
    'editorial 0..20',
  );
  data.components.schemas.UnselectedProbability = { type: 'string' };
  assert.equal(compareOfficialSchema(data, pinned), true);
});
test('probability annotation-named properties and literal defaults stay structural', () => {
  for (const name of ['description', 'example', 'examples', 'title', '$comment']) {
    const data = source();
    set(
      data.components.schemas,
      ['ChatTokenLogprob', 'properties', 'top_logprobs', 'items', 'properties', name],
      { type: 'string' },
    );
    assert.equal(compareOfficialSchema(data, pinned), false);
    const literal = source();
    set(literal.components.schemas, ['ChatTokenLogprobs', 'default'], { [name]: 'literal value' });
    assert.equal(compareOfficialSchema(literal, pinned), false);
  }
});
for (const name of ['ChatTokenLogprob', 'ChatTokenLogprobs'])
  test(`missing or malformed source probability definition ${name} fails safely`, () => {
    for (const invalid of [undefined, null, [], 'private invalid', 1]) {
      const data = source();
      data.components.schemas[name] = invalid;
      assert.throws(() => projectOfficialSchema(data), { message: 'Invalid official schema' });
    }
  });
for (const name of ['logprobs', 'top_logprobs'])
  test(`missing or malformed request probability field ${name} fails safely`, () => {
    for (const invalid of [undefined, null, [], 'private invalid', false]) {
      const data = source();
      set(data.components.schemas, ['ChatRequest', 'properties', name], invalid);
      assert.throws(() => projectOfficialSchema(data), { message: 'Invalid official schema' });
    }
  });
test('probability selection rejects stale versions and rehashed invalid exact maps', () => {
  for (let version = 1; version < 29; version++)
    assert.throws(() => validateSchemaPin({ ...pinned, version }), {
      message: 'Invalid schema pin',
    });
  for (const name of ['ChatTokenLogprob', 'ChatTokenLogprobs']) {
    const p = structuredClone(pinned.projection);
    delete p.responseDefinitions[name];
    assert.throws(() => validateSchemaPin(refreshed(p)), { message: 'Invalid schema pin' });
    for (const invalid of [null, [], 'private invalid']) {
      const altered = structuredClone(pinned.projection);
      altered.responseDefinitions[name] = invalid;
      assert.throws(() => validateSchemaPin(refreshed(altered)), { message: 'Invalid schema pin' });
    }
  }
  for (const name of ['logprobs', 'top_logprobs']) {
    const p = structuredClone(pinned.projection);
    delete p.fields[name];
    assert.throws(() => validateSchemaPin(refreshed(p)), { message: 'Invalid schema pin' });
  }
  const p = structuredClone(pinned.projection);
  p.responseDefinitions.Extra = {};
  assert.throws(() => validateSchemaPin(refreshed(p)), { message: 'Invalid schema pin' });
});
