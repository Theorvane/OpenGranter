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
          responses: {
            '200': {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ChatResult' } },
              },
            },
          },
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
            min_p: { type: ['number', 'null'], format: 'double' },
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
    logit_bias: structuredClone(pinned.projection.fields.logit_bias),
    stream_options: structuredClone(pinned.projection.fields.stream_options),
    tools: structuredClone(pinned.projection.fields.tools),
    tool_choice: structuredClone(pinned.projection.fields.tool_choice),
    parallel_tool_calls: structuredClone(pinned.projection.fields.parallel_tool_calls),
  });
  Object.assign(data.components.schemas, structuredClone(pinned.projection.definitions), {
    ChatToolMessage: structuredClone(pinned.projection.toolMessages.ChatToolMessage),
  });
  Object.assign(
    data.components.schemas,
    structuredClone(
      pinned.projection.streamDefinitions ?? {
        ChatStreamChunk: { type: 'object', properties: { choices: { type: 'array' } } },
        ChatStreamChoice: { type: 'object', properties: { index: { type: 'integer' } } },
        ChatStreamDelta: { type: 'object', properties: { content: { type: 'string' } } },
        ChatStreamOptions: { type: 'object', properties: { include_usage: { type: 'boolean' } } },
      },
    ),
  );
  Object.assign(data.components.schemas.ChatAssistantMessage.properties, {
    tool_calls: structuredClone(pinned.projection.toolMessages.ChatAssistantMessage.schema),
  });
  Object.assign(data.components.schemas, structuredClone(pinned.projection.responseDefinitions));
  Object.assign(data.components.schemas, structuredClone(pinned.projection.usageDefinitions));
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
    'logit_bias',
    'max_completion_tokens',
    'max_tokens',
    'messages',
    'min_p',
    'model',
    'parallel_tool_calls',
    'presence_penalty',
    'response_format',
    'seed',
    'stop',
    'stream',
    'stream_options',
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

const streamDefinitions = [
  'ChatStreamChunk',
  'ChatStreamChoice',
  'ChatStreamDelta',
  'ChatStreamOptions',
];
test('official projection selects streaming response definitions', () => {
  const projected = projectOfficialSchema(source()) as unknown as {
    streamDefinitions: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(projected.streamDefinitions).sort(), [...streamDefinitions].sort());
});

for (const name of streamDefinitions) {
  test(`${name}: structural drift and malformed source definitions fail safely`, () => {
    const changed = source();
    (changed.components as { schemas: Record<string, unknown> }).schemas[name] = { type: 'string' };
    assert.equal(compareOfficialSchema(changed, pinned), false);
    for (const malformed of [undefined, null, [], 'private value']) {
      const data = source();
      (data.components as { schemas: Record<string, unknown> }).schemas[name] = malformed;
      assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
    }
  });
}

test('stream definition annotations and unrelated definitions do not cause drift', () => {
  const data = source();
  const schemas = (data.components as { schemas: Record<string, Record<string, unknown>> }).schemas;
  assert.ok(schemas.ChatStreamChunk);
  schemas.ChatStreamChunk.description = 'editorial';
  schemas.UnrelatedStream = { type: 'number' };
  assert.equal(compareOfficialSchema(data, pinned), true);
});

test('rehashed streaming maps reject missing, extra and malformed definitions', () => {
  for (const streamDefinitions of [
    undefined,
    {},
    [],
    { ...pinned.projection.streamDefinitions, Extra: { type: 'object' } },
    { ...pinned.projection.streamDefinitions, ChatStreamDelta: null },
  ]) {
    const projection = { ...pinned.projection, streamDefinitions };
    if (streamDefinitions === undefined) delete projection.streamDefinitions;
    const projectionSha256 = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(
      () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
      /Invalid schema pin/,
    );
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
test('version-11 pin retains exact selected definitions', () => {
  assert.equal(pinned.version, 11);
  const definitions = (
    projectOfficialSchema(source()) as unknown as { definitions: Record<string, unknown> }
  ).definitions;
  assert.deepEqual(Object.keys(definitions).sort(), [
    'ChatFinishReasonEnum',
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
    if (name !== 'ChatAssistantMessage') {
      schema.properties.content = { type: 'number' };
      delete schema.required;
    }
  }
  assert.equal(compareOfficialSchema(data, pinned), true);
  const projected = projectOfficialSchema(data) as unknown as {
    messageNames: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(projected.messageNames).sort(), [...messageDefinitions].sort());
  for (const value of Object.values(projected.messageNames))
    assert.deepEqual(value, { schema: { type: 'string' }, required: false });
});
test('version-11 message maps reject stale and rehashed malformed pins', () => {
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
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

test('request projection selects the stream options reference', () => {
  const data = source();
  const schemas = (
    data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
  ).schemas;
  assert.ok(schemas.ChatRequest);
  schemas.ChatRequest.properties.stream_options = {
    $ref: '#/components/schemas/ChatStreamOptions',
  };
  assert.deepEqual(projectOfficialSchema(data).fields.stream_options, {
    $ref: '#/components/schemas/ChatStreamOptions',
  });
});

test('stream option reference, boolean type and deprecation changes are detected', () => {
  for (const variant of ['reference', 'type', 'deprecated']) {
    const data = source();
    const schemas = (
      data.components as {
        schemas: Record<string, { properties: Record<string, Record<string, unknown>> }>;
      }
    ).schemas;
    const field = schemas.ChatRequest?.properties.stream_options;
    const option = schemas.ChatStreamOptions?.properties.include_usage;
    assert.ok(field);
    assert.ok(option);
    if (variant === 'reference') field.$ref = '#/components/schemas/OtherOptions';
    if (variant === 'type') option.type = 'string';
    if (variant === 'deprecated') option.deprecated = false;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
});

test('logit_bias projection includes nullable numeric map structure', () => {
  const data = source();
  const schemas = (
    data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
  ).schemas;
  assert.ok(schemas.ChatRequest);
  schemas.ChatRequest.properties.logit_bias = {
    type: ['object', 'null'],
    additionalProperties: { type: 'number', format: 'double' },
  };
  assert.deepEqual(projectOfficialSchema(data).fields.logit_bias, {
    type: ['object', 'null'],
    additionalProperties: { type: 'number', format: 'double' },
  });
});

test('logit_bias nullable map, numeric values, format and constraints cause drift', () => {
  const shape = {
    type: ['object', 'null'],
    additionalProperties: { type: 'number', format: 'double' },
  };
  for (const replacement of [
    { ...shape, type: 'object' },
    { ...shape, additionalProperties: { type: 'integer', format: 'double' } },
    { ...shape, additionalProperties: { type: 'string' } },
    { ...shape, additionalProperties: false },
    { ...shape, additionalProperties: { type: 'number', format: 'float' } },
    {
      ...shape,
      additionalProperties: { type: 'number', format: 'double', minimum: -100, maximum: 100 },
    },
    { ...shape, propertyNames: { pattern: '^[0-9]+$' } },
    { ...shape, maxProperties: 10 },
    { ...shape, default: { description: 1 } },
  ]) {
    const data = source();
    const schemas = (
      data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
    ).schemas;
    assert.ok(schemas.ChatRequest);
    schemas.ChatRequest.properties.logit_bias = replacement;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
});

test('logit_bias malformed source and rehashed selected maps fail safely', () => {
  for (const malformed of [undefined, null, [], 'private invalid']) {
    const data = source();
    const schemas = (
      data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
    ).schemas;
    assert.ok(schemas.ChatRequest);
    schemas.ChatRequest.properties.logit_bias = malformed;
    assert.throws(() => projectOfficialSchema(data), { message: 'Invalid official schema' });
  }
  for (const operation of ['missing', 'extra', 'malformed']) {
    const fields = { ...pinned.projection.fields };
    if (operation === 'missing') delete fields.logit_bias;
    if (operation === 'extra') fields.unselected = { type: 'object' };
    if (operation === 'malformed') fields.logit_bias = null;
    const projection = { ...pinned.projection, fields };
    const hash = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(() => validateSchemaPin({ ...pinned, projection, projectionSha256: hash }), {
      message: 'Invalid schema pin',
    });
  }
});

test('logit_bias annotations remain ignored without dropping literal default keys', () => {
  const data = source();
  const schemas = (
    data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
  ).schemas;
  assert.ok(schemas.ChatRequest);
  schemas.ChatRequest.properties.logit_bias = {
    type: ['object', 'null'],
    description: 'editorial',
    example: { '1': 1 },
    additionalProperties: { type: 'number', format: 'double', description: 'editorial value' },
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  schemas.ChatRequest.properties.logit_bias = {
    type: ['object', 'null'],
    additionalProperties: { type: 'number', format: 'double' },
    default: { description: 1, example: 2 },
  };
  assert.deepEqual(projectOfficialSchema(data).fields.logit_bias, {
    type: ['object', 'null'],
    additionalProperties: { type: 'number', format: 'double' },
    default: { description: 1, example: 2 },
  });
});

const finishReasonShape = {
  enum: ['tool_calls', 'stop', 'length', 'content_filter', 'error', null],
  type: ['string', 'null'],
  'x-speakeasy-unknown-values': 'allow',
};
function finishReasonSource(shape: unknown = finishReasonShape) {
  const data = source();
  const schemas = (data.components as { schemas: Record<string, unknown> }).schemas;
  schemas.ChatFinishReasonEnum = structuredClone(shape);
  return data;
}

test('finish-reason projection selects the referenced enum without changing its reference', () => {
  const data = finishReasonSource();
  assert.deepEqual(projectOfficialSchema(data).definitions.ChatFinishReasonEnum, finishReasonShape);
});

test('finish-reason enum, nullability, type, constraints and literal defaults cause drift', () => {
  for (const shape of [
    { ...finishReasonShape, enum: [...finishReasonShape.enum, 'new_reason'] },
    { ...finishReasonShape, enum: finishReasonShape.enum.filter((value) => value !== 'error') },
    { ...finishReasonShape, enum: finishReasonShape.enum.filter((value) => value !== null) },
    { ...finishReasonShape, type: 'string' },
    { ...finishReasonShape, type: ['integer', 'null'] },
    { ...finishReasonShape, maxLength: 64 },
    { ...finishReasonShape, default: 'stop' },
    { ...finishReasonShape, 'x-speakeasy-unknown-values': 'reject' },
  ]) {
    assert.equal(compareOfficialSchema(finishReasonSource(shape), pinned), false);
  }
});

test('finish-reason annotations and unrelated response definitions remain ignored', () => {
  const data = finishReasonSource({
    ...finishReasonShape,
    description: 'editorial',
    example: 'stop',
  });
  (data.components as { schemas: Record<string, unknown> }).schemas.UnselectedResponse = {
    type: 'string',
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  assert.deepEqual(
    projectOfficialSchema(
      finishReasonSource({
        ...finishReasonShape,
        default: { description: 'literal', example: null },
      }),
    ).definitions.ChatFinishReasonEnum,
    {
      ...finishReasonShape,
      default: { description: 'literal', example: null },
    },
  );
});

test('finish-reason missing and malformed source definitions fail safely', () => {
  for (const shape of [undefined, null, [], 'private invalid']) {
    const data = finishReasonSource();
    const schemas = (data.components as { schemas: Record<string, unknown> }).schemas;
    if (shape === undefined) delete schemas.ChatFinishReasonEnum;
    else schemas.ChatFinishReasonEnum = shape;
    assert.throws(() => projectOfficialSchema(data), { message: 'Invalid official schema' });
  }
});

test('finish-reason rehashed missing, extra and malformed definition maps fail integrity', () => {
  for (const operation of ['missing', 'extra', 'malformed']) {
    const definitions = { ...pinned.projection.definitions };
    if (operation === 'missing') delete definitions.ChatFinishReasonEnum;
    if (operation === 'extra') definitions.UnselectedResponse = { type: 'object' };
    if (operation === 'malformed') definitions.ChatFinishReasonEnum = null;
    const projection = { ...pinned.projection, definitions };
    const hash = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(() => validateSchemaPin({ ...pinned, projection, projectionSha256: hash }), {
      message: 'Invalid schema pin',
    });
  }
});

function responseSource() {
  return source();
}
test('nonstream response projection selects the fixed success reference and exact definitions', () => {
  const value = projectOfficialSchema(responseSource()) as unknown as {
    responseRef: unknown;
    responseDefinitions: Record<string, unknown>;
  };
  assert.equal(value.responseRef, '#/components/schemas/ChatResult');
  assert.deepEqual(Object.keys(value.responseDefinitions).sort(), [
    'ChatAssistantMessage',
    'ChatChoice',
    'ChatResult',
  ]);
});

test('nonstream response required, fingerprint, choice and assistant structures cause drift', () => {
  for (const [name, field, shape] of [
    ['ChatResult', 'system_fingerprint', { type: 'string' }],
    [
      'ChatResult',
      'choices',
      { type: 'array', maxItems: 1, items: { $ref: '#/components/schemas/ChatChoice' } },
    ],
    ['ChatResult', 'usage', { $ref: '#/components/schemas/OtherUsage' }],
    ['ChatChoice', 'finish_reason', { type: ['string', 'null'] }],
    ['ChatChoice', 'message', { $ref: '#/components/schemas/OtherMessage' }],
    ['ChatAssistantMessage', 'reasoning', { type: 'string', maxLength: 64 }],
    ['ChatAssistantMessage', 'refusal', { type: ['string', 'null'], default: null }],
    ['ChatAssistantMessage', 'tool_calls', { type: 'array', maxItems: 8 }],
  ] as const) {
    const data = responseSource();
    const schema = (
      data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
    ).schemas[name];
    assert.ok(schema);
    schema.properties[field] = shape;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
  for (const name of ['ChatResult', 'ChatChoice', 'ChatAssistantMessage']) {
    const data = responseSource();
    const schema = (data.components as { schemas: Record<string, { required: string[] }> }).schemas[
      name
    ];
    assert.ok(schema);
    schema.required = [...schema.required, 'new_required'];
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
});

test('nonstream response path and missing/malformed definitions fail safely', () => {
  for (const schema of [
    undefined,
    null,
    [],
    { $ref: '#/components/schemas/OtherResult' },
    { type: 'object' },
  ]) {
    const data = responseSource();
    const post = (data.paths as { '/chat/completions': { post: Record<string, unknown> } })[
      '/chat/completions'
    ].post;
    post.responses = { '200': { content: { 'application/json': { schema } } } };
    assert.throws(() => projectOfficialSchema(data), { message: 'Invalid official schema' });
  }
  for (const name of ['ChatResult', 'ChatChoice', 'ChatAssistantMessage']) {
    for (const malformed of [undefined, null, [], 'private invalid']) {
      const data = responseSource();
      (data.components as { schemas: Record<string, unknown> }).schemas[name] = malformed;
      assert.throws(() => projectOfficialSchema(data), { message: 'Invalid official schema' });
    }
  }
});

test('nonstream response annotations stay ignored while literal default keys remain data', () => {
  const data = responseSource();
  const schemas = (data.components as { schemas: Record<string, Record<string, unknown>> }).schemas;
  for (const name of ['ChatResult', 'ChatChoice', 'ChatAssistantMessage']) {
    assert.ok(schemas[name]);
    Object.assign(schemas[name], { description: 'editorial', example: { private: 'example' } });
  }
  schemas.UnselectedResponse = { type: 'string' };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const assistant = schemas.ChatAssistantMessage;
  assert.ok(assistant);
  assistant.default = { description: 'literal', example: null };
  const value = projectOfficialSchema(data) as unknown as {
    responseDefinitions: Record<string, { default?: unknown }>;
  };
  assert.deepEqual(value.responseDefinitions.ChatAssistantMessage?.default, {
    description: 'literal',
    example: null,
  });
  assert.equal(compareOfficialSchema(data, pinned), false);
});

test('nonstream response rehashed incomplete/extra/malformed maps and references reject', () => {
  for (const map of [
    undefined,
    {},
    { ...pinned.projection.responseDefinitions, Extra: {} },
    { ...pinned.projection.responseDefinitions, ChatResult: null },
  ]) {
    const projection = { ...pinned.projection, responseDefinitions: map };
    if (map === undefined) delete projection.responseDefinitions;
    const hash = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(() => validateSchemaPin({ ...pinned, projection, projectionSha256: hash }), {
      message: 'Invalid schema pin',
    });
  }
  const projection = { ...pinned.projection, responseRef: '#/components/schemas/OtherResult' };
  const hash = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
  assert.throws(() => validateSchemaPin({ ...pinned, projection, projectionSha256: hash }), {
    message: 'Invalid schema pin',
  });
});

test('chat usage projection selects exact usage and billing definitions', () => {
  const value = projectOfficialSchema(source()) as unknown as {
    usageDefinitions?: Record<string, unknown>;
  };
  assert.ok(value.usageDefinitions);
  assert.deepEqual(Object.keys(value.usageDefinitions).sort(), [
    'ChatUsage',
    'CostDetails',
    'ServerToolUseDetails',
  ]);
});

function usageSchema(data: Record<string, unknown>, name: string) {
  const schemas = (
    data.components as {
      schemas: Record<string, { required?: string[]; properties: Record<string, unknown> }>;
    }
  ).schemas;
  const schema = schemas[name];
  assert.ok(schema);
  return schema;
}
test('chat usage counters, details, costs and references cause drift', () => {
  for (const [name, field, shape] of [
    ['ChatUsage', 'prompt_tokens', { type: ['integer', 'null'] }],
    ['ChatUsage', 'completion_tokens', { type: 'number' }],
    ['ChatUsage', 'total_tokens', { type: 'integer', minimum: 0 }],
    ['ChatUsage', 'cost', { type: 'number', format: 'float' }],
    ['ChatUsage', 'cost_details', { $ref: '#/components/schemas/OtherCost' }],
    ['ChatUsage', 'server_tool_use_details', { $ref: '#/components/schemas/OtherTools' }],
    [
      'ChatUsage',
      'prompt_tokens_details',
      { type: 'object', properties: { cached_tokens: { type: ['integer', 'null'] } } },
    ],
    [
      'ChatUsage',
      'completion_tokens_details',
      { type: ['object', 'null'], properties: { reasoning_tokens: { type: 'integer' } } },
    ],
    [
      'CostDetails',
      'upstream_inference_prompt_cost',
      { type: ['number', 'null'], format: 'double' },
    ],
    ['CostDetails', 'server_tool_cost', { type: 'number', format: 'double' }],
    ['ServerToolUseDetails', 'tool_calls_executed', { type: 'integer', maximum: 10 }],
  ] as const) {
    const data = source();
    usageSchema(data, name).properties[field] = shape;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
  for (const name of ['ChatUsage', 'CostDetails', 'ServerToolUseDetails']) {
    const data = source(),
      schema = usageSchema(data, name);
    schema.required = [...(schema.required ?? []), 'new_required'];
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
});
test('chat usage annotations and unrelated native definitions remain ignored', () => {
  const data = source();
  for (const name of ['ChatUsage', 'CostDetails', 'ServerToolUseDetails'])
    Object.assign(usageSchema(data, name), {
      description: 'editorial',
      examples: [{ private: 'annotation' }],
    });
  (data.components as { schemas: Record<string, unknown> }).schemas.AnthropicUsage = {
    type: 'number',
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  Object.assign(usageSchema(data, 'ChatUsage'), {
    default: { description: 'literal', example: null },
  });
  const projected = projectOfficialSchema(data) as unknown as {
    usageDefinitions: Record<string, { default?: unknown }>;
  };
  assert.deepEqual(projected.usageDefinitions.ChatUsage?.default, {
    description: 'literal',
    example: null,
  });
  assert.equal(compareOfficialSchema(data, pinned), false);
});
test('chat usage missing and malformed definitions fail safely', () => {
  for (const name of ['ChatUsage', 'CostDetails', 'ServerToolUseDetails'])
    for (const value of [undefined, null, [], 'private invalid']) {
      const data = source();
      const schemas = (data.components as { schemas: Record<string, unknown> }).schemas;
      if (value === undefined) delete schemas[name];
      else schemas[name] = value;
      assert.throws(() => projectOfficialSchema(data), { message: 'Invalid official schema' });
    }
});
test('chat usage rehashed missing, extra and malformed maps fail integrity', () => {
  for (const operation of ['missing', 'extra', 'malformed', 'absent']) {
    const map = { ...pinned.projection.usageDefinitions };
    if (operation === 'missing') delete map.ChatUsage;
    if (operation === 'extra') map.Extra = {};
    if (operation === 'malformed') map.CostDetails = null;
    const projection = { ...pinned.projection, usageDefinitions: map };
    if (operation === 'absent') delete projection.usageDefinitions;
    const hash = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(() => validateSchemaPin({ ...pinned, projection, projectionSha256: hash }), {
      message: 'Invalid schema pin',
    });
  }
});

test('min_p selection preserves the official nullable number structure', () => {
  const data = source();
  const properties = minPProperties(data);
  properties.min_p = { type: ['number', 'null'], format: 'double' };
  assert.deepEqual(projectOfficialSchema(data).fields.min_p, {
    type: ['number', 'null'],
    format: 'double',
  });
});

function minPProperties(data: Record<string, unknown>) {
  const schemas = (
    data.components as { schemas: Record<string, { properties: Record<string, unknown> }> }
  ).schemas;
  assert.ok(schemas.ChatRequest);
  return schemas.ChatRequest.properties;
}

test('min_p type, nullability, format, bounds and default changes cause drift', () => {
  for (const replacement of [
    { type: 'number', format: 'double' },
    { type: ['integer', 'null'], format: 'double' },
    { type: ['number', 'null'], format: 'float' },
    ...['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'default'].map(
      (key) => ({ type: ['number', 'null'], format: 'double', [key]: 0.5 }),
    ),
  ]) {
    const data = source();
    minPProperties(data).min_p = replacement;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
});

test('min_p annotations are ignored but literal default keys remain data', () => {
  const data = source();
  minPProperties(data).min_p = {
    type: ['number', 'null'],
    format: 'double',
    description: 'editorial',
    example: 0.2,
    title: 'editorial',
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const literal = { description: 'literal value', example: 0.3 };
  minPProperties(data).min_p = { type: ['number', 'null'], format: 'double', default: literal };
  assert.deepEqual(projectOfficialSchema(data).fields.min_p, {
    type: ['number', 'null'],
    format: 'double',
    default: literal,
  });
  assert.equal(compareOfficialSchema(data, pinned), false);
});

test('missing and malformed min_p source shapes fail safely', () => {
  for (const value of [undefined, null, [], 'private source value']) {
    const data = source();
    minPProperties(data).min_p = value;
    assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
  }
});

test('min_p exact field map rejects rehashed missing, extra and malformed selections', () => {
  for (const operation of ['missing', 'extra', 'malformed']) {
    const fields = { ...pinned.projection.fields };
    if (operation === 'missing') delete fields.min_p;
    if (operation === 'extra') fields.unselected = { type: 'number' };
    if (operation === 'malformed') fields.min_p = [];
    const projection = { ...pinned.projection, fields };
    const projectionSha256 = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(
      () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
      /Invalid schema pin/,
    );
  }
});
