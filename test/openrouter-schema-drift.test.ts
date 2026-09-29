import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  canonicalSchema,
  compareOfficialSchema,
  fetchOfficialSchema,
  projectOfficialSchema,
  validateSchemaPin,
} from '../scripts/openrouter-schema.ts';

function source(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { version: '1.0.0' },
    paths: {
      '/chat/completions': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatRequest' },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ChatRequest: {
          type: 'object',
          required: ['messages'],
          properties: {
            model: { $ref: '#/components/schemas/ModelName' },
            messages: {
              type: 'array',
              minItems: 1,
              items: { $ref: '#/components/schemas/ChatMessages' },
            },
            stream: { type: 'boolean', default: false },
            max_tokens: { type: ['integer', 'null'] },
            max_completion_tokens: { type: ['integer', 'null'] },
            stop: {
              anyOf: [
                { type: 'string' },
                { type: 'array', maxItems: 4, items: { type: 'string' } },
                { type: 'null' },
              ],
            },
            temperature: { type: ['number', 'null'], format: 'double' },
            top_p: { type: ['number', 'null'], format: 'double' },
            frequency_penalty: { type: ['number', 'null'], format: 'double' },
            presence_penalty: { type: ['number', 'null'], format: 'double' },
            response_format: {
              discriminator: {
                mapping: {
                  grammar: '#/components/schemas/ChatFormatGrammarConfig',
                  json_object: '#/components/schemas/ChatFormatJsonObjectConfig',
                  json_schema: '#/components/schemas/ChatFormatJsonSchemaConfig',
                  python: '#/components/schemas/ChatFormatPythonConfig',
                  text: '#/components/schemas/ChatFormatTextConfig',
                },
                propertyName: 'type',
              },
              oneOf: ['Text', 'JsonObject', 'JsonSchema', 'Grammar', 'Python'].map((name) => ({
                $ref: `#/components/schemas/ChatFormat${name}Config`,
              })),
            },
          },
        },
        ChatFormatTextConfig: {
          type: 'object',
          required: ['type'],
          properties: { type: { enum: ['text'], type: 'string' } },
        },
        ChatFormatJsonObjectConfig: {
          type: 'object',
          required: ['type'],
          properties: { type: { enum: ['json_object'], type: 'string' } },
        },
      },
    },
  };
}
const pinned = JSON.parse(
  await readFile(new URL('../contracts/openrouter-request-schema.json', import.meta.url), 'utf8'),
);

test('official projection and reviewed pin agree; key order is immaterial', () => {
  assert.equal(compareOfficialSchema(source(), pinned), true);
  assert.equal(canonicalSchema({ b: 2, a: 1 }), canonicalSchema({ a: 1, b: 2 }));
  assert.deepEqual(Object.keys(projectOfficialSchema(source()).fields).sort(), [
    'frequency_penalty',
    'max_completion_tokens',
    'max_tokens',
    'messages',
    'model',
    'presence_penalty',
    'response_format',
    'stop',
    'stream',
    'temperature',
    'top_p',
  ]);
});

test('meaningful field and required-list changes cause drift', () => {
  const raw = JSON.stringify(source());
  for (const altered of [
    raw.replace('"maxItems":4', '"maxItems":5'),
    raw.replace('"required":["messages"]', '"required":["messages","model"]'),
    raw.replace('"format":"double"', '"format":"float"'),
    raw.replace('"default":false', '"default":true'),
  ])
    assert.equal(compareOfficialSchema(JSON.parse(altered), pinned), false);
});

test('editorial and unrelated changes are ignored; schema keywords are preserved', () => {
  const data = source();
  data.unrelated = { description: 'unrelated' };
  const raw = JSON.stringify(data).replace(
    '"maxItems":4',
    '"maxItems":4,"description":"editorial","example":["x"]',
  );
  assert.equal(compareOfficialSchema(JSON.parse(raw), pinned), true);
});

test('missing fields, malformed references and unsupported schema versions fail safely', () => {
  const raw = JSON.stringify(source());
  for (const altered of [
    null,
    {},
    JSON.parse(raw.replace('3.1.0', '3.0.0')),
    JSON.parse(raw.replace('#/components/schemas/ChatRequest', 'https://untrusted.test/schema')),
    JSON.parse(raw.replace('"top_p":', '"other":')),
  ]) {
    assert.throws(() => projectOfficialSchema(altered), /Invalid official schema/);
  }
});

test('offline pin rejects corrupt projection and unsafe provenance', () => {
  assert.doesNotThrow(() => validateSchemaPin(pinned));
  for (const changes of [
    { projectionSha256: '0'.repeat(64) },
    { source: 'https://untrusted.test' },
    { sourceSha256: 'missing' },
    { retrievedAt: 'yesterday' },
    { version: 1 },
  ])
    assert.throws(() => validateSchemaPin({ ...pinned, ...changes }), /Invalid schema pin/);
  const corrupt = { ...pinned, projection: {} };
  corrupt.projectionSha256 = createHash('sha256')
    .update(canonicalSchema(corrupt.projection))
    .digest('hex');
  assert.throws(() => validateSchemaPin(corrupt), /Invalid schema pin/);
});

test('fixed-source fetch uses no credentials or redirects and returns matching source', async () => {
  const downloaded = await fetchOfficialSchema(async (url, init) => {
    assert.equal(String(url), 'https://openrouter.ai/openapi.json');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.headers, undefined);
    assert.ok(init?.signal);
    return Response.json(source());
  });
  assert.equal(compareOfficialSchema(downloaded, pinned), true);
});

test('transport, HTTP, malformed and oversized sources use fixed failure messages', async () => {
  for (const fetcher of [
    async () => {
      throw new Error('private transport details');
    },
    async () => new Response('private body', { status: 503 }),
    async () => new Response('private invalid JSON'),
    async () => new Response('x'.repeat(8 * 1024 * 1024 + 1)),
  ])
    await assert.rejects(fetchOfficialSchema(fetcher), { message: 'Official schema unavailable' });
});

test('deadline ends even when the fake transport ignores abort', async () => {
  await assert.rejects(
    fetchOfficialSchema(() => new Promise(() => {}), 10),
    {
      message: 'Official schema unavailable',
    },
  );
});

test('annotation-like property names and literal defaults remain structural data', () => {
  const raw = JSON.stringify(source()).replace(
    '"type":"boolean","default":false',
    '"type":"boolean","default":{"description":"literal"},"properties":{"description":{"type":"string","description":"annotation"}}',
  );
  const result = projectOfficialSchema(JSON.parse(raw));
  assert.deepEqual(result.fields.stream, {
    type: 'boolean',
    default: { description: 'literal' },
    properties: { description: { type: 'string' } },
  });
});

test('offline CLI validates the pin without requiring network access', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      new URL('../scripts/check-openrouter-schema.ts', import.meta.url).pathname,
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'PASS pinned OpenRouter request schema integrity');
});

test('CLI rejects arbitrary source arguments with a safe nonzero exit', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      new URL('../scripts/check-openrouter-schema.ts', import.meta.url).pathname,
      'https://untrusted.test/private',
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(result.status, 1);
  assert.ok(
    result.stderr.includes('FAIL OpenRouter schema check unavailable or invalid; no pin changed'),
  );
  assert.equal(result.stderr.includes('https://untrusted.test'), false);
});

for (const field of ['frequency_penalty', 'presence_penalty', 'response_format'])
  test(`newly supported field drift is detected: ${field}`, () => {
    const data = source();
    const schemas = (
      data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
    ).schemas;
    assert.ok(schemas.ChatRequest);
    schemas.ChatRequest.properties[field] = { type: 'boolean' };
    assert.equal(compareOfficialSchema(data, pinned), false);
  });
for (const name of ['ChatFormatTextConfig', 'ChatFormatJsonObjectConfig']) {
  test(`referenced supported format drift is detected: ${name}`, () => {
    const data = source();
    const schemas = (data.components as { schemas: Record<string, unknown> }).schemas;
    schemas[name] = { type: 'object', required: ['type', 'extra'] };
    assert.equal(compareOfficialSchema(data, pinned), false);
  });
  test(`missing/malformed supported definitions fail safely: ${name}`, () => {
    for (const value of [undefined, null, [], 'private value']) {
      const data = source();
      const schemas = (data.components as { schemas: Record<string, unknown> }).schemas;
      schemas[name] = value;
      assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
    }
  });
}
test('version-2 pin includes exact selected format definitions', () => {
  assert.equal(pinned.version, 2);
  const definitions = (
    projectOfficialSchema(source()) as unknown as { definitions: Record<string, unknown> }
  ).definitions;
  assert.deepEqual(Object.keys(definitions).sort(), [
    'ChatFormatJsonObjectConfig',
    'ChatFormatTextConfig',
  ]);
});

test('supported definition annotations and unrelated format definitions are ignored', () => {
  const data = source();
  const schemas = (data.components as { schemas: Record<string, Record<string, unknown>> }).schemas;
  assert.ok(schemas.ChatFormatTextConfig);
  schemas.ChatFormatTextConfig.description = 'editorial';
  assert.ok(schemas.ChatFormatJsonObjectConfig);
  schemas.ChatFormatJsonObjectConfig.example = { type: 'json_object' };
  schemas.ChatFormatGrammarConfig = { type: 'object', privateAnnotation: 'irrelevant' };
  assert.equal(compareOfficialSchema(data, pinned), true);
});
test('rehashed pin rejects missing, extra and malformed selected definition maps', () => {
  for (const definitions of [
    undefined,
    {},
    [],
    { ...pinned.projection.definitions, Extra: { type: 'string' } },
    { ...pinned.projection.definitions, ChatFormatTextConfig: null },
  ]) {
    const projection = { ...pinned.projection, definitions };
    if (definitions === undefined) delete projection.definitions;
    const hash = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(
      () => validateSchemaPin({ ...pinned, projection, projectionSha256: hash }),
      /Invalid schema pin/,
    );
  }
});
