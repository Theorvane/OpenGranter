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
  const data = {
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
            seed: { type: ['integer', 'null'] },
            top_k: { type: ['integer', 'null'] },
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
            tools: { type: 'array', items: { $ref: '#/components/schemas/ChatFunctionTool' } },
            tool_choice: { $ref: '#/components/schemas/ChatNamedToolChoice' },
            parallel_tool_calls: { type: 'boolean', default: true },
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
        ChatFunctionTool: {
          type: 'object',
          required: ['type', 'function'],
          properties: { type: { const: 'function' } },
        },
        ChatNamedToolChoice: {
          type: 'object',
          required: ['type', 'function'],
          properties: { type: { const: 'function' } },
        },
        ChatToolCall: {
          type: 'object',
          required: ['id', 'type', 'function'],
          properties: { id: { type: 'string' } },
        },
        ChatToolMessage: {
          type: 'object',
          required: ['role', 'content', 'tool_call_id'],
          properties: { role: { const: 'tool' }, tool_call_id: { type: 'string' } },
        },
        ...Object.fromEntries(
          [
            'ChatSystemMessage',
            'ChatDeveloperMessage',
            'ChatUserMessage',
            'ChatAssistantMessage',
          ].map((name) => [
            name,
            { type: 'object', required: ['role'], properties: { name: { type: 'string' } } },
          ]),
        ),
        ChatAssistantMessage: {
          type: 'object',
          required: ['role'],
          properties: {
            name: { type: 'string' },
            tool_calls: { type: 'array', items: { $ref: '#/components/schemas/ChatToolCall' } },
          },
        },
      },
    },
  };
  Object.assign(data.components.schemas.ChatRequest.properties, {
    tools: structuredClone(pinned.projection.fields.tools),
    tool_choice: structuredClone(pinned.projection.fields.tool_choice),
    parallel_tool_calls: structuredClone(pinned.projection.fields.parallel_tool_calls),
  });
  Object.assign(data.components.schemas, structuredClone(pinned.projection.definitions), {
    ChatToolMessage: structuredClone(pinned.projection.toolMessages.ChatToolMessage),
  });
  Object.assign(data.components.schemas.ChatAssistantMessage.properties, {
    tool_calls: structuredClone(pinned.projection.toolMessages.ChatAssistantMessage.schema),
  });
  return data;
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
    'parallel_tool_calls',
    'presence_penalty',
    'response_format',
    'seed',
    'stop',
    'stream',
    'temperature',
    'tool_choice',
    'tools',
    'top_k',
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

test('function-tool request, definition and history changes cause drift', () => {
  const data = source();
  const projected = projectOfficialSchema(data) as unknown as Record<string, unknown>;
  const fields = projected.fields as Record<string, unknown>;
  const definitions = projected.definitions as Record<string, unknown>;
  const messages = projected.toolMessages as Record<string, unknown>;
  for (const name of ['tools', 'tool_choice', 'parallel_tool_calls']) assert.ok(fields[name]);
  for (const name of ['ChatFunctionTool', 'ChatToolChoice', 'ChatNamedToolChoice', 'ChatToolCall'])
    assert.ok(definitions[name]);
  assert.ok(messages.ChatAssistantMessage);
  assert.ok(messages.ChatToolMessage);
  const alterations = [
    (schemas: Record<string, unknown>) => {
      const request = schemas.ChatRequest as { properties: Record<string, unknown> };
      request.properties.parallel_tool_calls = { type: 'string' };
    },
    (schemas: Record<string, unknown>) => {
      schemas.ChatFunctionTool = { type: 'string' };
    },
    (schemas: Record<string, unknown>) => {
      const tool = schemas.ChatToolMessage as { required: string[] };
      tool.required = [...tool.required, 'extra'];
    },
    (schemas: Record<string, unknown>) => {
      const assistant = schemas.ChatAssistantMessage as { properties: Record<string, unknown> };
      assistant.properties.tool_calls = { type: 'string' };
    },
  ];
  for (const alter of alterations) {
    const changed = source();
    alter((changed.components as { schemas: Record<string, unknown> }).schemas);
    assert.equal(compareOfficialSchema(changed, pinned), false);
  }
});

test('missing or malformed selected tool structures fail safely', () => {
  for (const name of ['tools', 'tool_choice', 'parallel_tool_calls']) {
    const data = source();
    const request = (data.components as { schemas: Record<string, unknown> }).schemas
      .ChatRequest as { properties: Record<string, unknown> };
    request.properties[name] = null;
    assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
  }
  for (const name of [
    'ChatFunctionTool',
    'ChatToolChoice',
    'ChatNamedToolChoice',
    'ChatToolCall',
    'ChatToolMessage',
  ]) {
    const data = source();
    (data.components as { schemas: Record<string, unknown> }).schemas[name] = null;
    assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
  }
  const data = source();
  const assistant = (data.components as { schemas: Record<string, unknown> }).schemas
    .ChatAssistantMessage as { properties: Record<string, unknown> };
  assistant.properties.tool_calls = null;
  assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
});

test('tool annotations are ignored and tool pin shape is closed', () => {
  const data = source();
  const schemas = (data.components as { schemas: Record<string, Record<string, unknown>> }).schemas;
  assert.ok(schemas.ChatToolCall);
  assert.ok(schemas.ChatToolMessage);
  schemas.ChatToolCall.description = 'editorial';
  schemas.ChatToolMessage.example = { content: 'editorial' };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const projection = {
    ...pinned.projection,
    toolMessages: { ...pinned.projection.toolMessages, Extra: {} },
  };
  const projectionSha256 = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
  assert.throws(
    () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
    /Invalid schema pin/,
  );
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
test('version-4 pin retains exact selected definitions', () => {
  assert.equal(pinned.version, 4);
  const definitions = (
    projectOfficialSchema(source()) as unknown as { definitions: Record<string, unknown> }
  ).definitions;
  assert.deepEqual(Object.keys(definitions).sort(), [
    'ChatFormatJsonObjectConfig',
    'ChatFormatTextConfig',
    'ChatFunctionTool',
    'ChatNamedToolChoice',
    'ChatToolCall',
    'ChatToolChoice',
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

for (const field of ['seed', 'top_k']) {
  test(`${field}: integer/nullability/constraint drift is detected`, () => {
    for (const replacement of [
      { type: 'integer' },
      { type: ['number', 'null'] },
      { type: ['integer', 'null'], minimum: 0 },
    ]) {
      const data = source();
      const schemas = (
        data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
      ).schemas;
      assert.ok(schemas.ChatRequest);
      schemas.ChatRequest.properties[field] = replacement;
      assert.equal(compareOfficialSchema(data, pinned), false);
    }
  });
  test(`${field}: missing or malformed selected field fails safely`, () => {
    for (const replacement of [undefined, null, [], 'private value']) {
      const data = source();
      const schemas = (
        data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
      ).schemas;
      assert.ok(schemas.ChatRequest);
      schemas.ChatRequest.properties[field] = replacement;
      assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
    }
  });
}

test('sampling field maps reject stale or malformed rehashed projections', () => {
  for (const field of ['seed', 'top_k'])
    for (const operation of ['missing', 'malformed', 'extra']) {
      const fields = { ...pinned.projection.fields };
      if (operation === 'missing') delete fields[field];
      else if (operation === 'malformed') fields[field] = null;
      else fields.unselected = { type: 'string' };
      const projection = { ...pinned.projection, fields };
      const hash = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
      assert.throws(
        () => validateSchemaPin({ ...pinned, projection, projectionSha256: hash }),
        /Invalid schema pin/,
      );
    }
});
test('sampling field annotations are ignored while literal constraints remain data', () => {
  const data = source();
  const schemas = (
    data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
  ).schemas;
  assert.ok(schemas.ChatRequest);
  for (const field of ['seed', 'top_k'])
    schemas.ChatRequest.properties[field] = {
      type: ['integer', 'null'],
      description: 'editorial',
      example: 42,
    };
  assert.equal(compareOfficialSchema(data, pinned), true);
});

const messageDefinitions = [
  'ChatSystemMessage',
  'ChatDeveloperMessage',
  'ChatUserMessage',
  'ChatAssistantMessage',
];
function messageSchema(data: Record<string, unknown>, name: string) {
  const schemas = (data.components as { schemas: Record<string, unknown> }).schemas;
  return schemas[name] as { type: string; required?: unknown; properties: Record<string, unknown> };
}
for (const name of messageDefinitions) {
  test(`${name}: name constraints and required status drift without reference changes`, () => {
    for (const schema of [
      { type: ['string', 'null'] },
      { type: 'number' },
      { type: 'string', maxLength: 64 },
      { type: 'string', default: { description: 'literal' } },
    ]) {
      const data = source();
      messageSchema(data, name).properties.name = schema;
      assert.equal(compareOfficialSchema(data, pinned), false);
    }
    const data = source();
    messageSchema(data, name).required = ['role', 'name'];
    assert.equal(compareOfficialSchema(data, pinned), false);
  });
  test(`${name}: malformed selected containers, name fields and required lists reject safely`, () => {
    for (const value of [undefined, null, [], 'private invalid']) {
      const data = source();
      messageSchema(data, name).properties.name = value;
      assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
      const absent = source();
      (absent.components as { schemas: Record<string, unknown> }).schemas[name] = value;
      assert.throws(() => projectOfficialSchema(absent), /Invalid official schema/);
    }
    for (const value of [null, {}, 'name', [null], [''], ['name', 'name']]) {
      const data = source();
      messageSchema(data, name).required = value;
      assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
    }
    const data = source();
    messageSchema(data, name).type = 'array';
    assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
  });
}
test('message name selection ignores editorial and unrelated message changes', () => {
  const data = source();
  for (const name of messageDefinitions) {
    const schema = messageSchema(data, name);
    schema.properties.name = {
      type: 'string',
      description: 'private annotation',
      example: 'example',
    };
    schema.properties.content = { type: 'number' };
    delete schema.required;
  }
  assert.equal(compareOfficialSchema(data, pinned), true);
  const projected = projectOfficialSchema(data) as unknown as {
    messageNames: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(projected.messageNames).sort(), [...messageDefinitions].sort());
  for (const value of Object.values(projected.messageNames))
    assert.deepEqual(value, { schema: { type: 'string' }, required: false });
});
test('version-4 message maps reject stale and rehashed malformed pins', () => {
  for (const version of [1, 2, 3])
    assert.throws(() => validateSchemaPin({ ...pinned, version }), /Invalid schema pin/);
  for (const messageNames of [
    undefined,
    {},
    [],
    { ...pinned.projection.messageNames, Extra: { schema: { type: 'string' }, required: false } },
    { ...pinned.projection.messageNames, ChatUserMessage: null },
    { ...pinned.projection.messageNames, ChatUserMessage: { schema: null, required: false } },
    {
      ...pinned.projection.messageNames,
      ChatUserMessage: { schema: { type: 'string' }, required: 'false' },
    },
    {
      ...pinned.projection.messageNames,
      ChatUserMessage: { schema: { type: 'string' }, required: false, extra: true },
    },
  ]) {
    const projection = { ...pinned.projection, messageNames };
    if (messageNames === undefined) delete projection.messageNames;
    const projectionSha256 = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(
      () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
      /Invalid schema pin/,
    );
  }
});
