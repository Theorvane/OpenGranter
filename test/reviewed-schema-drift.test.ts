import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  compareOfficialModelResponseSchema,
  validateModelResponseSchemaPin,
} from '../scripts/openrouter-model-response-schema.ts';
import {
  canonicalSchema,
  compareOfficialSchema,
  validateSchemaPin,
} from '../scripts/openrouter-schema.ts';

const chat = JSON.parse(
  await readFile(new URL('../contracts/openrouter-request-schema.json', import.meta.url), 'utf8'),
);
const models = JSON.parse(
  await readFile(
    new URL('../contracts/openrouter-model-response-schema.json', import.meta.url),
    'utf8',
  ),
);
const hash = (value: unknown) => createHash('sha256').update(canonicalSchema(value)).digest('hex');
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const safeguard = { type: 'array', items: ref('ArmorSafeguardResult') };
const functionBranch = {
  type: 'object',
  required: ['type', 'function'],
  properties: {
    type: { type: 'string', enum: ['function'] },
    cache_control: ref('ChatContentCacheControl'),
    defer_loading: { type: 'boolean' },
    function: {
      type: 'object',
      required: ['name'],
      properties: {
        defer_loading: { type: 'boolean' },
        name: { type: 'string', maxLength: 64 },
        description: { type: 'string' },
        parameters: { type: 'object', additionalProperties: {} },
        strict: { type: ['boolean', 'null'] },
      },
    },
  },
};
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
  for (const [name, entry] of Object.entries(p.messageNames)) {
    const item = entry as { schema: object; required: boolean };
    schemas[name].properties.name = item.schema;
    schemas[name].required = (schemas[name].required ?? []).filter((key: string) => key !== 'name');
    if (item.required) schemas[name].required.push('name');
  }
  schemas.ChatAssistantMessage.properties.tool_calls = p.toolMessages.ChatAssistantMessage.schema;
  schemas.ChatToolMessage = p.toolMessages.ChatToolMessage;
  schemas.ChatFunctionTool.anyOf[0] = structuredClone(functionBranch);
  schemas.ChatResult.properties.alignment = ref('Alignment');
  schemas.ChatResult.properties.safeguard_results = structuredClone(safeguard);
  schemas.ChatStreamChunk.properties.alignment = { allOf: [ref('Alignment'), {}] };
  schemas.ChatStreamChunk.properties.safeguard_results = structuredClone(safeguard);
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
    components: { schemas },
  };
}
test('reviewed chat v32 shapes match independent optional field definitions', () => {
  assert.equal(chat.version, 32);
  assert.deepEqual(
    chat.projection.responseDefinitions.ChatResult.properties.alignment,
    ref('Alignment'),
  );
  assert.deepEqual(
    chat.projection.responseDefinitions.ChatResult.properties.safeguard_results,
    safeguard,
  );
  assert.deepEqual(chat.projection.streamDefinitions.ChatStreamChunk.properties.alignment, {
    allOf: [ref('Alignment'), {}],
  });
  assert.deepEqual(
    chat.projection.streamDefinitions.ChatStreamChunk.properties.safeguard_results,
    safeguard,
  );
  assert.deepEqual(chat.projection.definitions.ChatFunctionTool.anyOf[0], functionBranch);
  assert.equal(compareOfficialSchema(chatSource(), chat), true);
  for (const name of ['ChatResult', 'ChatStreamChunk']) {
    const schema = chatSource().components.schemas[name];
    assert.equal(schema.required.includes('alignment'), false);
    assert.equal(schema.required.includes('safeguard_results'), false);
  }
});
for (const name of ['ChatResult', 'ChatStreamChunk']) {
  for (const field of ['alignment', 'safeguard_results']) {
    for (const change of ['missing', 'reference', 'required']) {
      test(`${name} ${field} ${change} detects drift`, () => {
        const s = chatSource();
        const schema = s.components.schemas[name];
        if (change === 'missing') delete schema.properties[field];
        else if (change === 'reference') schema.properties[field] = ref('ChangedTarget');
        else schema.required.push(field);
        assert.equal(compareOfficialSchema(s, chat), false);
      });
    }
  }
}
for (const nested of [false, true]) {
  for (const change of ['missing', 'type', 'required']) {
    test(`deferred tool flag nested=${nested} ${change} detects drift`, () => {
      const s = chatSource();
      let schema = s.components.schemas.ChatFunctionTool.anyOf[0];
      if (nested) schema = schema.properties.function;
      if (change === 'missing') delete schema.properties.defer_loading;
      else if (change === 'type') schema.properties.defer_loading = { type: ['boolean', 'null'] };
      else schema.required.push('defer_loading');
      assert.equal(compareOfficialSchema(s, chat), false);
    });
  }
}
test('new referenced target bodies remain explicitly outside the bounded chat selection', () => {
  const s = chatSource();
  for (const name of ['Alignment', 'AlignmentCallRecord', 'ArmorSafeguardResult']) {
    assert.equal(Object.hasOwn(chat.projection.responseDefinitions, name), false);
    s.components.schemas[name] = { type: 'boolean', 'x-unselected': true };
  }
  assert.equal(compareOfficialSchema(s, chat), true);
});
test('reversing only the six reviewed additions reproduces the complete v31 digest', () => {
  const p = structuredClone(chat.projection);
  for (const schema of [p.responseDefinitions.ChatResult, p.streamDefinitions.ChatStreamChunk]) {
    delete schema.properties.alignment;
    delete schema.properties.safeguard_results;
  }
  delete p.definitions.ChatFunctionTool.anyOf[0].properties.defer_loading;
  delete p.definitions.ChatFunctionTool.anyOf[0].properties.function.properties.defer_loading;
  assert.equal(hash(p), '0bf32d91e86d7c0cbb41042133f781ce3b6bb299bef2396a41a8a9d920a069e2');
  assert.throws(
    () => validateSchemaPin({ ...chat, version: 31, projection: p, projectionSha256: hash(p) }),
    /^TypeError: Invalid schema pin$/,
  );
});
const nullableFields = [
  ['DefaultParameters', 'frequency_penalty', 'number'],
  ['DefaultParameters', 'presence_penalty', 'number'],
  ['DefaultParameters', 'repetition_penalty', 'number'],
  ['DefaultParameters', 'temperature', 'number'],
  ['DefaultParameters', 'top_p', 'number'],
  ['TopProviderInfo', 'context_length', 'integer'],
  ['TopProviderInfo', 'max_completion_tokens', 'integer'],
] as const;
function modelSource() {
  const p = structuredClone(models.projection);
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
for (const [name, field, type] of nullableFields) {
  test(`${name}.${field} retains explicit nullability without a legacy marker`, () => {
    const schema = models.projection.definitions[name].properties[field];
    assert.deepEqual(
      schema,
      type === 'number'
        ? { type: ['number', 'null'], format: 'double' }
        : { type: ['integer', 'null'] },
    );
    const s = modelSource();
    assert.equal(compareOfficialModelResponseSchema(s, models), true);
    s.components.schemas[name].properties[field] = { ...schema, nullable: true };
    assert.equal(compareOfficialModelResponseSchema(s, models), false);
    s.components.schemas[name].properties[field] = { ...schema, type };
    assert.equal(compareOfficialModelResponseSchema(s, models), false);
  });
}
test('restoring only seven legacy markers reproduces the complete v1 model-response digest', () => {
  assert.equal(models.version, 2);
  const p = structuredClone(models.projection);
  for (const [name, field] of nullableFields) p.definitions[name].properties[field].nullable = true;
  assert.equal(hash(p), '825714729401e81ab4a6196b7a8ed6b76d89a32c09869d02a18e812276ced87b');
  assert.throws(
    () =>
      validateModelResponseSchemaPin({
        ...models,
        version: 1,
        projection: p,
        projectionSha256: hash(p),
      }),
    /^TypeError: Invalid model-response schema pin$/,
  );
});
