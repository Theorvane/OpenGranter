import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  compareOfficialModelQuerySchema,
  validateModelQuerySchemaPin,
} from '../scripts/openrouter-model-query-schema.ts';
import {
  compareOfficialModelResponseSchema,
  validateModelResponseSchemaPin,
} from '../scripts/openrouter-model-response-schema.ts';
import {
  canonicalSchema,
  compareOfficialSchema,
  validateSchemaPin,
} from '../scripts/openrouter-schema.ts';

const [chat, query, response] = await Promise.all(
  ['request', 'model-query', 'model-response'].map(async (name) =>
    JSON.parse(
      await readFile(
        new URL(`../contracts/openrouter-${name}-schema.json`, import.meta.url),
        'utf8',
      ),
    ),
  ),
);
const hash = (value: unknown) => createHash('sha256').update(canonicalSchema(value)).digest('hex');
const fields = [
  ['DefaultParameters', 'frequency_penalty', 'number'],
  ['DefaultParameters', 'presence_penalty', 'number'],
  ['DefaultParameters', 'repetition_penalty', 'number'],
  ['DefaultParameters', 'temperature', 'number'],
  ['DefaultParameters', 'top_p', 'number'],
  ['TopProviderInfo', 'context_length', 'integer'],
  ['TopProviderInfo', 'max_completion_tokens', 'integer'],
] as const;
function chatSource() {
  const p = structuredClone(chat.projection);
  const schemas = {
    ...p.definitions,
    ...p.streamDefinitions,
    ...p.reasoningDefinitions,
    ...p.usageDefinitions,
    ...p.responseDefinitions,
    ChatRequest: { type: 'object', required: p.required, properties: p.fields },
  };
  for (const [name, raw] of Object.entries(p.messageNames)) {
    const entry = raw as { schema: object; required: boolean };
    schemas[name].properties.name = entry.schema;
    schemas[name].required = (schemas[name].required ?? []).filter((key: string) => key !== 'name');
    if (entry.required) schemas[name].required.push('name');
  }
  schemas.ChatAssistantMessage.properties.tool_calls = p.toolMessages.ChatAssistantMessage.schema;
  schemas.ChatToolMessage = p.toolMessages.ChatToolMessage;
  schemas.PromptCacheBreakpoint.properties.ttl = { type: ['string', 'null'] };
  return {
    openapi: p.openapi,
    info: { version: p.documentVersion },
    components: { schemas },
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
  };
}
function querySource() {
  const p = structuredClone(query.projection);
  delete p.parameters.offset.schema.nullable;
  return {
    openapi: p.openapi,
    info: { version: p.documentVersion },
    paths: {
      '/models': { get: { operationId: p.operationId, parameters: Object.values(p.parameters) } },
    },
  };
}
function responseSource() {
  const p = structuredClone(response.projection);
  for (const [name, field] of fields) p.definitions[name].properties[field].nullable = true;
  return {
    openapi: p.openapi,
    info: { version: p.documentVersion },
    paths: {
      '/models': {
        get: {
          operationId: p.operationId,
          responses: { '200': { content: { 'application/json': { schema: p.schema } } } },
        },
      },
    },
    components: { schemas: p.definitions },
  };
}
test('reviewed versions and independent TTL/offset/property shapes match the fetched source', () => {
  assert.deepEqual([chat.version, query.version, response.version], [33, 5, 3]);
  assert.deepEqual(chat.projection.definitions.PromptCacheBreakpoint.properties.ttl, {
    type: ['string', 'null'],
  });
  assert.deepEqual(chat.projection.definitions.PromptCacheBreakpoint.required, ['mode']);
  assert.deepEqual(query.projection.parameters.offset.schema, {
    default: 0,
    minimum: 0,
    type: ['integer', 'null'],
  });
  assert.equal(compareOfficialSchema(chatSource(), chat), true);
  assert.equal(compareOfficialModelQuerySchema(querySource(), query), true);
  assert.equal(compareOfficialModelResponseSchema(responseSource(), response), true);
});
for (const [name, field, type] of fields)
  test(`reviewed ${name}.${field} includes the legacy marker and explicit nullable type`, () => {
    const schema = response.projection.definitions[name].properties[field];
    assert.deepEqual(schema, {
      type: [type, 'null'],
      ...(type === 'number' ? { format: 'double' } : {}),
      nullable: true,
    });
    const source = responseSource();
    delete source.components.schemas[name].properties[field].nullable;
    assert.equal(compareOfficialModelResponseSchema(source, response), false);
    source.components.schemas[name].properties[field] = { ...schema, type };
    assert.equal(compareOfficialModelResponseSchema(source, response), false);
  });
for (const change of ['missing', 'type', 'required', 'enum'])
  test(`breakpoint TTL ${change} remains a monitored structural change`, () => {
    const source = chatSource();
    const breakpoint = source.components.schemas.PromptCacheBreakpoint;
    if (change === 'missing') delete breakpoint.properties.ttl;
    else if (change === 'type') breakpoint.properties.ttl = { type: 'string' };
    else if (change === 'required') breakpoint.required.push('ttl');
    else breakpoint.properties.ttl.enum = ['1h'];
    assert.equal(compareOfficialSchema(source, chat), false);
  });
test('restoring offset nullable:false and annotation-only TTL handling preserve structural boundaries', () => {
  const q = querySource();
  const offset = q.paths['/models'].get.parameters.find(
    (p) => (p as { name: string }).name === 'offset',
  ) as { schema: Record<string, unknown> };
  offset.schema.nullable = false;
  assert.equal(compareOfficialModelQuerySchema(q, query), false);
  const c = chatSource();
  c.components.schemas.PromptCacheBreakpoint.properties.ttl.description = 'editorial';
  assert.equal(compareOfficialSchema(c, chat), true);
});
for (const [name, pin, version, digest, validate] of [
  [
    'request',
    chat,
    32,
    '03612bdd85051a62e6862d3f06ac92ab62ba02f5a8be90ef5660f6bef743dc7e',
    validateSchemaPin,
  ],
  [
    'query',
    query,
    4,
    'aa9f1298d0c56d6d786499f859c3ee9062b2bc01407e2c9926bff1e85921ff62',
    validateModelQuerySchemaPin,
  ],
  [
    'response',
    response,
    2,
    '5d8b334d04ca90d1c4d1b587771b12f135a56c78dd9d532661dd60202d55b6af',
    validateModelResponseSchemaPin,
  ],
] as const) {
  test(`${name} complete previous projection remains exactly reconstructible and stale`, () => {
    const p = structuredClone(pin.projection);
    if (name === 'request') delete p.definitions.PromptCacheBreakpoint.properties.ttl;
    else if (name === 'query') p.parameters.offset.schema.nullable = false;
    else for (const [key, field] of fields) delete p.definitions[key].properties[field].nullable;
    assert.equal(hash(p), digest);
    assert.throws(
      () => validate({ ...pin, version, projection: p, projectionSha256: hash(p) }),
      TypeError,
    );
  });
}
