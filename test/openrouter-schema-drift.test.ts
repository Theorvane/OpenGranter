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

const reasoningShapes = {
  ChatReasoningDetails: {
    items: {
      $ref: '#/components/schemas/ReasoningDetailUnion',
    },
    type: 'array',
  },
  ChatStreamReasoningDetails: {
    items: {
      $ref: '#/components/schemas/ReasoningDetailUnion',
    },
    type: 'array',
  },
  ReasoningDetailUnion: {
    discriminator: {
      mapping: {
        'reasoning.encrypted': '#/components/schemas/ReasoningDetailEncrypted',
        'reasoning.server_tool_call': '#/components/schemas/ReasoningDetailServerToolCall',
        'reasoning.summary': '#/components/schemas/ReasoningDetailSummary',
        'reasoning.text': '#/components/schemas/ReasoningDetailText',
      },
      propertyName: 'type',
    },
    oneOf: [
      {
        $ref: '#/components/schemas/ReasoningDetailSummary',
      },
      {
        $ref: '#/components/schemas/ReasoningDetailEncrypted',
      },
      {
        $ref: '#/components/schemas/ReasoningDetailText',
      },
      {
        $ref: '#/components/schemas/ReasoningDetailServerToolCall',
      },
    ],
  },
  ReasoningDetailSummary: {
    properties: {
      format: {
        $ref: '#/components/schemas/ReasoningFormat',
      },
      id: {
        type: ['string', 'null'],
      },
      index: {
        type: 'integer',
      },
      summary: {
        type: 'string',
      },
      type: {
        enum: ['reasoning.summary'],
        type: 'string',
      },
    },
    required: ['type', 'summary'],
    type: 'object',
  },
  ReasoningDetailEncrypted: {
    properties: {
      data: {
        type: 'string',
      },
      format: {
        $ref: '#/components/schemas/ReasoningFormat',
      },
      id: {
        type: ['string', 'null'],
      },
      index: {
        type: 'integer',
      },
      type: {
        enum: ['reasoning.encrypted'],
        type: 'string',
      },
    },
    required: ['type', 'data'],
    type: 'object',
  },
  ReasoningDetailText: {
    properties: {
      format: {
        $ref: '#/components/schemas/ReasoningFormat',
      },
      id: {
        type: ['string', 'null'],
      },
      index: {
        type: 'integer',
      },
      signature: {
        type: ['string', 'null'],
      },
      text: {
        type: ['string', 'null'],
      },
      type: {
        enum: ['reasoning.text'],
        type: 'string',
      },
    },
    required: ['type'],
    type: 'object',
  },
  ReasoningDetailServerToolCall: {
    properties: {
      arguments: {
        type: 'string',
      },
      format: {
        $ref: '#/components/schemas/ReasoningFormat',
      },
      id: {
        type: ['string', 'null'],
      },
      index: {
        type: 'integer',
      },
      result: {
        type: 'string',
      },
      tool_call_id: {
        type: ['string', 'null'],
      },
      tool_name: {
        type: 'string',
      },
      type: {
        enum: ['reasoning.server_tool_call'],
        type: 'string',
      },
    },
    required: ['type', 'tool_name', 'arguments', 'result'],
    type: 'object',
  },
  ReasoningFormat: {
    enum: [
      'unknown',
      'openai-responses-v1',
      'azure-openai-responses-v1',
      'bedrock-openai-responses-v1',
      'bedrock-xai-responses-v1',
      'xai-responses-v1',
      'meta-responses-v1',
      'anthropic-claude-v1',
      'google-gemini-v1',
      null,
    ],
    type: ['string', 'null'],
    'x-speakeasy-unknown-values': 'allow',
  },
};

const jsonSchemaShapes = {
  ChatFormatJsonSchemaConfig: {
    type: 'object',
    required: ['type', 'json_schema'],
    properties: {
      type: { enum: ['json_schema'], type: 'string' },
      json_schema: { $ref: '#/components/schemas/ChatJsonSchemaConfig' },
    },
  },
  ChatJsonSchemaConfig: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 64 },
      description: { type: 'string' },
      schema: { type: 'object', additionalProperties: {} },
      strict: { type: ['boolean', 'null'] },
    },
  },
};

const reasoningRequestShape = {
  type: 'object',
  properties: {
    effort: {
      type: ['string', 'null'],
      enum: ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none', null],
      'x-speakeasy-unknown-values': 'allow',
    },
    summary: { $ref: '#/components/schemas/ChatReasoningSummaryVerbosityEnum' },
  },
};
const reasoningSummaryShape = {
  type: ['string', 'null'],
  enum: ['auto', 'concise', 'detailed', null],
  'x-speakeasy-unknown-values': 'allow',
};

const historyShapes = {
  ChatMessages: {
    discriminator: {
      mapping: {
        assistant: '#/components/schemas/ChatAssistantMessage',
        developer: '#/components/schemas/ChatDeveloperMessage',
        system: '#/components/schemas/ChatSystemMessage',
        tool: '#/components/schemas/ChatToolMessage',
        user: '#/components/schemas/ChatUserMessage',
      },
      propertyName: 'role',
    },
    oneOf: [
      {
        $ref: '#/components/schemas/ChatSystemMessage',
      },
      {
        $ref: '#/components/schemas/ChatUserMessage',
      },
      {
        $ref: '#/components/schemas/ChatDeveloperMessage',
      },
      {
        $ref: '#/components/schemas/ChatAssistantMessage',
      },
      {
        $ref: '#/components/schemas/ChatToolMessage',
      },
    ],
  },
  ChatSystemMessage: {
    properties: {
      configuration_update: {
        additionalProperties: false,
        properties: {
          reasoning: {
            $ref: '#/components/schemas/ConfigurationUpdateReasoning',
          },
        },
        required: ['reasoning'],
        type: ['object', 'null'],
      },
      content: {
        anyOf: [
          {
            type: 'string',
          },
          {
            items: {
              $ref: '#/components/schemas/ChatContentText',
            },
            type: 'array',
          },
        ],
      },
      name: {
        type: 'string',
      },
      role: {
        enum: ['system'],
        type: 'string',
      },
    },
    required: ['role', 'content'],
    type: 'object',
  },
  ChatDeveloperMessage: {
    properties: {
      configuration_update: {
        additionalProperties: false,
        properties: {
          reasoning: {
            $ref: '#/components/schemas/ConfigurationUpdateReasoning',
          },
        },
        required: ['reasoning'],
        type: ['object', 'null'],
      },
      content: {
        anyOf: [
          {
            type: 'string',
          },
          {
            items: {
              $ref: '#/components/schemas/ChatContentText',
            },
            type: 'array',
          },
        ],
      },
      name: {
        type: 'string',
      },
      role: {
        enum: ['developer'],
        type: 'string',
      },
    },
    required: ['role', 'content'],
    type: 'object',
  },
  ChatUserMessage: {
    properties: {
      content: {
        anyOf: [
          {
            type: 'string',
          },
          {
            items: {
              $ref: '#/components/schemas/ChatContentItems',
            },
            type: 'array',
          },
        ],
      },
      name: {
        type: 'string',
      },
      role: {
        enum: ['user'],
        type: 'string',
      },
    },
    required: ['role', 'content'],
    type: 'object',
  },
};

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
            user: { type: 'string' },
            prompt_cache_key: { type: ['string', 'null'] },
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
            top_a: { type: ['number', 'null'], format: 'double' },
            repetition_penalty: { type: ['number', 'null'], format: 'double' },
            reasoning_effort: {
              type: ['string', 'null'],
              enum: ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none', null],
              'x-speakeasy-unknown-values': 'allow',
            },
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
        ...structuredClone(jsonSchemaShapes),
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
    reasoning: structuredClone(reasoningRequestShape),
    logit_bias: structuredClone(pinned.projection.fields.logit_bias),
    stream_options: structuredClone(pinned.projection.fields.stream_options),
    tools: structuredClone(pinned.projection.fields.tools),
    tool_choice: structuredClone(pinned.projection.fields.tool_choice),
    parallel_tool_calls: structuredClone(pinned.projection.fields.parallel_tool_calls),
  });
  Object.assign(data.components.schemas, structuredClone(historyShapes));
  Object.assign(data.components.schemas, structuredClone(pinned.projection.definitions), {
    ChatReasoningSummaryVerbosityEnum: structuredClone(reasoningSummaryShape),
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
  Object.assign(data.components.schemas.ChatRequest.properties, {
    logprobs: { type: ['boolean', 'null'] },
    top_logprobs: { type: ['integer', 'null'] },
  });
  Object.assign(data.components.schemas, structuredClone(pinned.projection.usageDefinitions));
  Object.assign(data.components.schemas, structuredClone(reasoningShapes));
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
    'logprobs',
    'max_completion_tokens',
    'max_tokens',
    'messages',
    'min_p',
    'model',
    'parallel_tool_calls',
    'presence_penalty',
    'prompt_cache_key',
    'reasoning',
    'reasoning_effort',
    'repetition_penalty',
    'response_format',
    'seed',
    'stop',
    'stream',
    'stream_options',
    'temperature',
    'tool_choice',
    'tools',
    'top_a',
    'top_k',
    'top_logprobs',
    'top_p',
    'user',
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
  'ChatStreamToolCall',
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
test('version-22 pin retains exact selected definitions', () => {
  assert.equal(pinned.version, 22);
  const definitions = (
    projectOfficialSchema(source()) as unknown as { definitions: Record<string, unknown> }
  ).definitions;
  assert.deepEqual(Object.keys(definitions).sort(), [
    'ChatDeveloperMessage',
    'ChatFinishReasonEnum',
    'ChatFormatJsonObjectConfig',
    'ChatFormatJsonSchemaConfig',
    'ChatFormatTextConfig',
    'ChatFunctionTool',
    'ChatJsonSchemaConfig',
    'ChatMessages',
    'ChatNamedToolChoice',
    'ChatReasoningSummaryVerbosityEnum',
    'ChatSystemMessage',
    'ChatToolCall',
    'ChatToolChoice',
    'ChatUserMessage',
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
test('message selections ignore editorial annotations but detect content and required changes', () => {
  const data = source();
  for (const name of messageDefinitions) {
    const schema = messageSchema(data, name);
    schema.properties.name = {
      type: 'string',
      description: 'private annotation',
      example: 'example',
    };
  }
  assert.equal(compareOfficialSchema(data, pinned), true);
  const projected = projectOfficialSchema(data) as unknown as {
    messageNames: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(projected.messageNames).sort(), [...messageDefinitions].sort());
  for (const value of Object.values(projected.messageNames))
    assert.deepEqual(value, { schema: { type: 'string' }, required: false });
});
test('version-22 message maps reject stale and rehashed malformed pins', () => {
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
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
    'ChatTokenLogprob',
    'ChatTokenLogprobs',
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
  const properties = chatRequestProperties(data);
  properties.min_p = { type: ['number', 'null'], format: 'double' };
  assert.deepEqual(projectOfficialSchema(data).fields.min_p, {
    type: ['number', 'null'],
    format: 'double',
  });
});

test('client user source selection preserves exact non-nullable shape and version 22', () => {
  assert.equal(pinned.version, 22);
  const projection = projectOfficialSchema(source()) as unknown as {
    fields: Record<string, unknown>;
  };
  assert.deepEqual(projection.fields.user, { type: 'string' });
  assert.equal(Object.keys(projection.fields).length, 27);
});
for (const [index, schema] of [
  { type: ['string', 'null'] },
  { type: 'integer' },
  { type: 'string', minLength: 1 },
  { type: 'string', maxLength: 512 },
  { type: 'string', pattern: 'opaque' },
  { type: 'string', default: 'private' },
  { type: 'string', deprecated: true },
  { type: 'string', 'x-client-identity': true },
].entries())
  test(`client user structural drift ${index} cannot be hidden by unchanged request references`, () => {
    const data = source();
    chatRequestProperties(data).user = schema;
    assert.equal(compareOfficialSchema(data, pinned), false);
  });
test('client user required status drift is detected', () => {
  const data = source();
  const request = schemasOf(data).ChatRequest as Record<string, unknown>;
  assert.ok(request);
  request.required = ['messages', 'user'];
  assert.equal(compareOfficialSchema(data, pinned), false);
});
test('client user editorial descriptions stay outside the structural projection', () => {
  const data = source();
  chatRequestProperties(data).user = {
    type: 'string',
    description: 'private changed prose',
    example: 'private example',
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
});
test('client user missing and malformed selected source fields fail safely', () => {
  for (const user of [undefined, null, [], 'private']) {
    const data = source();
    const fields = chatRequestProperties(data);
    if (user === undefined) delete fields.user;
    else fields.user = user;
    assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
  }
});
test('client user exact pin map rejects stale versions and rehashed missing or extra fields', () => {
  assert.throws(() => validateSchemaPin({ ...pinned, version: 20 }), /Invalid schema pin/);
  for (const change of ['missing', 'extra', 'malformed'] as const) {
    const projection = structuredClone(pinned.projection);
    const fields = projection.fields as Record<string, unknown>;
    if (change === 'missing') delete fields.user;
    else if (change === 'extra') fields.private = { type: 'string' };
    else fields.user = null;
    const projectionSha256 = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(
      () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
      /Invalid schema pin/,
    );
  }
});

test('cache key source selection preserves nullable string and exact version-22 map', () => {
  assert.equal(pinned.version, 22);
  const projection = projectOfficialSchema(source());
  assert.deepEqual(projection.fields.prompt_cache_key, { type: ['string', 'null'] });
  assert.equal(Object.keys(projection.fields).length, 27);
});
for (const [index, schema] of [
  { type: 'string' },
  { type: ['integer', 'null'] },
  { type: ['string', 'null'], minLength: 1 },
  { type: ['string', 'null'], maxLength: 64 },
  { type: ['string', 'null'], default: 'private' },
  { type: ['string', 'null'], pattern: 'opaque' },
  { type: ['string', 'null'], 'x-cache-key': true },
].entries())
  test(`cache key structural drift ${index} cannot hide behind unchanged request references`, () => {
    const data = source();
    chatRequestProperties(data).prompt_cache_key = schema;
    assert.equal(compareOfficialSchema(data, pinned), false);
  });
test('cache key required drift is detected and annotation changes are ignored', () => {
  const data = source();
  chatRequestProperties(data).prompt_cache_key = {
    type: ['string', 'null'],
    description: 'private prose',
    example: 'private key',
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const request = schemasOf(data).ChatRequest as Record<string, unknown>;
  request.required = ['messages', 'prompt_cache_key'];
  assert.equal(compareOfficialSchema(data, pinned), false);
});
test('cache key missing or malformed source fields and stale rehashed pin maps reject', () => {
  for (const value of [undefined, null, [], 'private']) {
    const data = source();
    const fields = chatRequestProperties(data);
    if (value === undefined) delete fields.prompt_cache_key;
    else fields.prompt_cache_key = value;
    assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
  }
  assert.throws(() => validateSchemaPin({ ...pinned, version: 21 }), /Invalid schema pin/);
  for (const operation of ['missing', 'malformed', 'extra']) {
    const projection = structuredClone(pinned.projection);
    const fields = projection.fields as Record<string, unknown>;
    if (operation === 'missing') delete fields.prompt_cache_key;
    else if (operation === 'malformed') fields.prompt_cache_key = null;
    else fields.private = { type: 'string' };
    const projectionSha256 = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(
      () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
      /Invalid schema pin/,
    );
  }
});

function chatRequestProperties(data: Record<string, unknown>) {
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
    chatRequestProperties(data).min_p = replacement;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
});

test('min_p annotations are ignored but literal default keys remain data', () => {
  const data = source();
  chatRequestProperties(data).min_p = {
    type: ['number', 'null'],
    format: 'double',
    description: 'editorial',
    example: 0.2,
    title: 'editorial',
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const literal = { description: 'literal value', example: 0.3 };
  chatRequestProperties(data).min_p = {
    type: ['number', 'null'],
    format: 'double',
    default: literal,
  };
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
    chatRequestProperties(data).min_p = value;
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

test('top_a selection preserves the official nullable number structure', () => {
  const data = source();
  const properties = chatRequestProperties(data);
  properties.top_a = { type: ['number', 'null'], format: 'double' };
  assert.deepEqual(projectOfficialSchema(data).fields.top_a, {
    type: ['number', 'null'],
    format: 'double',
  });
});
test('top_a type, nullability, format, bounds and default changes cause drift', () => {
  for (const replacement of [
    { type: 'number', format: 'double' },
    { type: ['integer', 'null'], format: 'double' },
    { type: ['number', 'null'], format: 'float' },
    ...['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'default'].map(
      (key) => ({ type: ['number', 'null'], format: 'double', [key]: 0.5 }),
    ),
  ]) {
    const data = source();
    chatRequestProperties(data).top_a = replacement;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
});

test('top_a annotations are ignored but literal default keys remain data', () => {
  const data = source();
  chatRequestProperties(data).top_a = {
    type: ['number', 'null'],
    format: 'double',
    description: 'editorial',
    example: 0.2,
    title: 'editorial',
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const literal = { description: 'literal value', example: 0.3 };
  chatRequestProperties(data).top_a = {
    type: ['number', 'null'],
    format: 'double',
    default: literal,
  };
  assert.deepEqual(projectOfficialSchema(data).fields.top_a, {
    type: ['number', 'null'],
    format: 'double',
    default: literal,
  });
  assert.equal(compareOfficialSchema(data, pinned), false);
});

test('missing and malformed top_a source shapes fail safely', () => {
  for (const value of [undefined, null, [], 'private source value']) {
    const data = source();
    chatRequestProperties(data).top_a = value;
    assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
  }
});

test('top_a exact field map rejects rehashed missing, extra and malformed selections', () => {
  for (const operation of ['missing', 'extra', 'malformed']) {
    const fields = { ...pinned.projection.fields };
    if (operation === 'missing') delete fields.top_a;
    if (operation === 'extra') fields.unselected = { type: 'number' };
    if (operation === 'malformed') fields.top_a = [];
    const projection = { ...pinned.projection, fields };
    const projectionSha256 = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(
      () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
      /Invalid schema pin/,
    );
  }
});

test('repetition_penalty selection preserves the official nullable number structure', () => {
  const data = source();
  const properties = chatRequestProperties(data);
  properties.repetition_penalty = { type: ['number', 'null'], format: 'double' };
  assert.deepEqual(projectOfficialSchema(data).fields.repetition_penalty, {
    type: ['number', 'null'],
    format: 'double',
  });
});
test('repetition_penalty type, nullability, format, bounds and default changes cause drift', () => {
  for (const replacement of [
    { type: 'number', format: 'double' },
    { type: ['integer', 'null'], format: 'double' },
    { type: ['number', 'null'], format: 'float' },
    ...['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'default'].map(
      (key) => ({ type: ['number', 'null'], format: 'double', [key]: 0.5 }),
    ),
  ]) {
    const data = source();
    chatRequestProperties(data).repetition_penalty = replacement;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
});

test('repetition_penalty annotations are ignored but literal default keys remain data', () => {
  const data = source();
  chatRequestProperties(data).repetition_penalty = {
    type: ['number', 'null'],
    format: 'double',
    description: 'editorial',
    example: 0.2,
    title: 'editorial',
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const literal = { description: 'literal value', example: 0.3 };
  chatRequestProperties(data).repetition_penalty = {
    type: ['number', 'null'],
    format: 'double',
    default: literal,
  };
  assert.deepEqual(projectOfficialSchema(data).fields.repetition_penalty, {
    type: ['number', 'null'],
    format: 'double',
    default: literal,
  });
  assert.equal(compareOfficialSchema(data, pinned), false);
});

test('missing and malformed repetition_penalty source shapes fail safely', () => {
  for (const value of [undefined, null, [], 'private source value']) {
    const data = source();
    chatRequestProperties(data).repetition_penalty = value;
    assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
  }
});

test('repetition_penalty exact field map rejects rehashed missing, extra and malformed selections', () => {
  for (const operation of ['missing', 'extra', 'malformed']) {
    const fields = { ...pinned.projection.fields };
    if (operation === 'missing') delete fields.repetition_penalty;
    if (operation === 'extra') fields.unselected = { type: 'number' };
    if (operation === 'malformed') fields.repetition_penalty = [];
    const projection = { ...pinned.projection, fields };
    const projectionSha256 = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(
      () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
      /Invalid schema pin/,
    );
  }
});

const effortSchema = {
  type: ['string', 'null'],
  enum: ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none', null],
  'x-speakeasy-unknown-values': 'allow',
};

test('reasoning_effort selection preserves the official nullable enum structure', () => {
  const data = source();
  chatRequestProperties(data).reasoning_effort = structuredClone(effortSchema);
  assert.deepEqual(projectOfficialSchema(data).fields.reasoning_effort, effortSchema);
});

test('reasoning_effort type enum null default extension and required changes cause drift', () => {
  for (const replacement of [
    { ...effortSchema, type: 'string' },
    { ...effortSchema, type: ['number', 'null'] },
    { ...effortSchema, enum: effortSchema.enum.filter((value) => value !== 'max') },
    { ...effortSchema, enum: effortSchema.enum.filter((value) => value !== null) },
    { ...effortSchema, enum: [...effortSchema.enum, 'unknown'] },
    { ...effortSchema, default: 'medium' },
    { ...effortSchema, 'x-speakeasy-unknown-values': 'reject' },
  ]) {
    const data = source();
    chatRequestProperties(data).reasoning_effort = replacement;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
  const data = source();
  const schemas = data.components as { schemas: { ChatRequest: { required: string[] } } };
  schemas.schemas.ChatRequest.required.push('reasoning_effort');
  assert.equal(compareOfficialSchema(data, pinned), false);
});

test('reasoning_effort annotations are ignored and literal defaults remain data', () => {
  const data = source();
  chatRequestProperties(data).reasoning_effort = {
    ...effortSchema,
    description: 'editorial',
    example: 'high',
    title: 'editorial',
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const literal = { description: 'literal value', example: 'high' };
  chatRequestProperties(data).reasoning_effort = { ...effortSchema, default: literal };
  assert.deepEqual(projectOfficialSchema(data).fields.reasoning_effort, {
    ...effortSchema,
    default: literal,
  });
  assert.equal(compareOfficialSchema(data, pinned), false);
});

test('missing and malformed reasoning_effort source shapes fail safely', () => {
  for (const value of [undefined, null, [], 'private source value']) {
    const data = source();
    chatRequestProperties(data).reasoning_effort = value;
    assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
  }
});

test('reasoning_effort exact field map rejects rehashed invalid selections', () => {
  for (const operation of ['missing', 'extra', 'malformed']) {
    const fields = { ...pinned.projection.fields };
    if (operation === 'missing') delete fields.reasoning_effort;
    if (operation === 'extra') fields.unselected = { type: 'string' };
    if (operation === 'malformed') fields.reasoning_effort = [];
    const projection = { ...pinned.projection, fields };
    const projectionSha256 = createHash('sha256').update(canonicalSchema(projection)).digest('hex');
    assert.throws(
      () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
      /Invalid schema pin/,
    );
  }
});

function reasoningProjection(data: unknown) {
  return (
    projectOfficialSchema(data) as unknown as { reasoningDefinitions: Record<string, unknown> }
  ).reasoningDefinitions;
}
function schemasOf(data: Record<string, unknown>) {
  return (data.components as { schemas: Record<string, unknown> }).schemas;
}
test('referenced reasoning details select every transitive definition', () => {
  assert.deepEqual(reasoningProjection(source()), reasoningShapes);
});
test('reasoning wrappers union variants and format changes cause drift with fixed parent references', () => {
  for (const [name, replacement] of [
    ['ChatReasoningDetails', { ...reasoningShapes.ChatReasoningDetails, minItems: 1 }],
    [
      'ChatStreamReasoningDetails',
      { ...reasoningShapes.ChatStreamReasoningDetails, type: ['array', 'null'] },
    ],
    [
      'ReasoningDetailUnion',
      { ...reasoningShapes.ReasoningDetailUnion, oneOf: [{ type: 'string' }] },
    ],
    [
      'ReasoningDetailUnion',
      { ...reasoningShapes.ReasoningDetailUnion, discriminator: { propertyName: 'other' } },
    ],
    ['ReasoningDetailSummary', { ...reasoningShapes.ReasoningDetailSummary, required: ['type'] }],
    [
      'ReasoningDetailText',
      {
        ...reasoningShapes.ReasoningDetailText,
        properties: {
          ...reasoningShapes.ReasoningDetailText.properties,
          signature: { type: 'string' },
          text: { type: 'integer' },
        },
      },
    ],
    [
      'ReasoningDetailEncrypted',
      {
        ...reasoningShapes.ReasoningDetailEncrypted,
        properties: {
          ...reasoningShapes.ReasoningDetailEncrypted.properties,
          data: { type: 'string', maxLength: 8 },
        },
      },
    ],
    [
      'ReasoningDetailServerToolCall',
      { ...reasoningShapes.ReasoningDetailServerToolCall, required: ['type'] },
    ],
    ['ReasoningFormat', { ...reasoningShapes.ReasoningFormat, enum: ['unknown'] }],
    [
      'ReasoningFormat',
      { ...reasoningShapes.ReasoningFormat, 'x-speakeasy-unknown-values': 'reject' },
    ],
  ] as const) {
    const data = source();
    schemasOf(data)[name] = replacement;
    assert.equal(compareOfficialSchema(data, pinned), false, name);
  }
});
test('reasoning annotations remain ignored while literal defaults remain structural data', () => {
  const data = source();
  for (const [name, shape] of Object.entries(reasoningShapes))
    schemasOf(data)[name] = {
      ...shape,
      description: 'editorial',
      example: 'editorial',
      title: 'editorial',
    };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const literal = { description: 'literal data', example: 'literal example' };
  schemasOf(data).ReasoningDetailText = {
    ...reasoningShapes.ReasoningDetailText,
    default: literal,
  };
  assert.deepEqual(reasoningProjection(data).ReasoningDetailText, {
    ...reasoningShapes.ReasoningDetailText,
    default: literal,
  });
  assert.equal(compareOfficialSchema(data, pinned), false);
});
test('missing and malformed reasoning definition sources fail safely', () => {
  for (const name of Object.keys(reasoningShapes)) {
    for (const value of [undefined, null, [], 'private malformed']) {
      const data = source();
      schemasOf(data)[name] = value;
      assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
    }
  }
});
test('reasoning parent references and required status remain tracked in both response modes', () => {
  for (const name of ['ChatAssistantMessage', 'ChatStreamDelta']) {
    for (const operation of ['reference', 'required', 'missing']) {
      const data = source();
      const schema = schemasOf(data)[name] as {
        properties: Record<string, unknown>;
        required?: string[];
      };
      if (operation === 'reference') schema.properties.reasoning_details = { type: 'array' };
      if (operation === 'required')
        schema.required = [...(schema.required ?? []), 'reasoning_details'];
      if (operation === 'missing') delete schema.properties.reasoning_details;
      assert.equal(compareOfficialSchema(data, pinned), false);
    }
  }
});
test('reasoning exact map rejects rehashed missing extra and malformed entries', () => {
  const definitions = (pinned.projection as { reasoningDefinitions: Record<string, unknown> })
    .reasoningDefinitions;
  for (const name of Object.keys(reasoningShapes)) {
    for (const operation of ['missing', 'extra', 'malformed']) {
      const reasoningDefinitions = { ...definitions };
      if (operation === 'missing') delete reasoningDefinitions[name];
      if (operation === 'extra') reasoningDefinitions.unselected = { type: 'string' };
      if (operation === 'malformed') reasoningDefinitions[name] = [];
      const projection = { ...pinned.projection, reasoningDefinitions };
      const projectionSha256 = createHash('sha256')
        .update(canonicalSchema(projection))
        .digest('hex');
      assert.throws(
        () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
        /Invalid schema pin/,
      );
    }
  }
});

test('JSON-schema wrapper and config are selected exactly', () => {
  const definitions = projectOfficialSchema(source()).definitions;
  for (const [name, shape] of Object.entries(jsonSchemaShapes))
    assert.deepEqual(definitions[name], shape);
});
test('JSON-schema structure drift is detected with unchanged parent references', () => {
  const wrapper = jsonSchemaShapes.ChatFormatJsonSchemaConfig;
  const config = jsonSchemaShapes.ChatJsonSchemaConfig;
  for (const [name, shape] of [
    ['ChatFormatJsonSchemaConfig', { ...wrapper, required: ['type'] }],
    [
      'ChatFormatJsonSchemaConfig',
      {
        ...wrapper,
        properties: { ...wrapper.properties, type: { enum: ['other'], type: 'string' } },
      },
    ],
    [
      'ChatFormatJsonSchemaConfig',
      {
        ...wrapper,
        properties: { ...wrapper.properties, json_schema: { $ref: '#/components/schemas/Other' } },
      },
    ],
    ['ChatJsonSchemaConfig', { ...config, required: ['name', 'schema'] }],
    ...[
      ['name', { type: 'string', maxLength: 32 }],
      ['name', { type: 'string', pattern: '^[a-z]+$' }],
      ['description', { type: ['string', 'null'] }],
      ['schema', { type: 'object', additionalProperties: false }],
      ['schema', { type: 'boolean' }],
      ['strict', { type: 'boolean' }],
      ['strict', { type: ['boolean', 'null'], default: true }],
    ].map(([key, value]) => [
      'ChatJsonSchemaConfig',
      { ...config, properties: { ...config.properties, [String(key)]: value } },
    ]),
  ]) {
    const data = source();
    schemasOf(data)[String(name)] = shape;
    assert.equal(compareOfficialSchema(data, pinned), false, String(name));
  }
});
test('JSON-schema annotations are ignored while description properties and literal annotation keys stay structural', () => {
  const data = source();
  for (const [name, shape] of Object.entries(jsonSchemaShapes))
    schemasOf(data)[name] = {
      ...shape,
      description: 'editorial',
      example: { private: 'editorial' },
      title: 'editorial',
    };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const literal = { description: 'literal data', example: 'literal example' };
  const config = { ...jsonSchemaShapes.ChatJsonSchemaConfig, default: literal };
  schemasOf(data).ChatJsonSchemaConfig = config;
  assert.deepEqual(projectOfficialSchema(data).definitions.ChatJsonSchemaConfig, config);
  assert.equal(compareOfficialSchema(data, pinned), false);
});
test('missing or malformed JSON-schema source definitions fail safely', () => {
  for (const name of Object.keys(jsonSchemaShapes))
    for (const value of [undefined, null, [], 'private malformed']) {
      const data = source();
      schemasOf(data)[name] = value;
      assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
    }
});
test('JSON-schema exact definition map rejects rehashed missing extra and malformed pins', () => {
  for (const name of Object.keys(jsonSchemaShapes))
    for (const operation of ['missing', 'extra', 'malformed']) {
      const definitions = { ...pinned.projection.definitions };
      if (operation === 'missing') delete definitions[name];
      if (operation === 'extra') definitions.unselected = { type: 'object' };
      if (operation === 'malformed') definitions[name] = [];
      const projection = { ...pinned.projection, definitions };
      const projectionSha256 = createHash('sha256')
        .update(canonicalSchema(projection))
        .digest('hex');
      assert.throws(
        () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
        /Invalid schema pin/,
      );
    }
});

test('message history union and complete instruction/user schemas are selected exactly', () => {
  const definitions = projectOfficialSchema(source()).definitions;
  for (const [name, shape] of Object.entries(historyShapes))
    assert.deepEqual(definitions[name], JSON.parse(canonicalSchema(shape)));
});
test('message history structural drift is detected with unchanged request and variant references', () => {
  const union = historyShapes.ChatMessages;
  for (const shape of [
    { ...union, oneOf: union.oneOf.slice(0, -1) },
    { ...union, oneOf: [...union.oneOf, { $ref: '#/components/schemas/Other' }] },
    { ...union, discriminator: { ...union.discriminator, propertyName: 'other' } },
    {
      ...union,
      discriminator: {
        ...union.discriminator,
        mapping: { ...union.discriminator.mapping, assistant: '#/components/schemas/Other' },
      },
    },
    { ...union, default: { description: 'literal', role: 'user' } },
    { ...union, 'x-speakeasy-unknown-values': 'allow' },
  ]) {
    const data = source();
    schemasOf(data).ChatMessages = shape;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
  for (const name of ['ChatSystemMessage', 'ChatDeveloperMessage', 'ChatUserMessage'] as const) {
    const shape = historyShapes[name];
    for (const variant of [
      { ...shape, required: ['role'] },
      { ...shape, properties: { ...shape.properties, role: { type: 'string', enum: ['other'] } } },
      { ...shape, properties: { ...shape.properties, content: { type: ['string', 'null'] } } },
      {
        ...shape,
        properties: {
          ...shape.properties,
          content: { type: 'string', maxLength: 100, default: { example: 'literal' } },
        },
      },
      {
        ...shape,
        properties: {
          ...shape.properties,
          content: { type: 'array', items: { $ref: '#/components/schemas/Other' } },
        },
      },
      { ...shape, additionalProperties: false },
    ]) {
      const data = source();
      schemasOf(data)[name] = variant;
      assert.equal(compareOfficialSchema(data, pinned), false, name);
    }
  }
  const data = source();
  const shape = historyShapes.ChatSystemMessage;
  schemasOf(data).ChatSystemMessage = {
    ...shape,
    properties: {
      ...shape.properties,
      configuration_update: {
        ...shape.properties.configuration_update,
        properties: { reasoning: { $ref: '#/components/schemas/Other' } },
      },
    },
  };
  assert.equal(compareOfficialSchema(data, pinned), false);
});
test('history annotations are ignored but literal defaults and annotation-named properties remain structural', () => {
  const data = source();
  for (const [name, shape] of Object.entries(historyShapes))
    schemasOf(data)[name] = {
      ...shape,
      description: 'private editorial',
      examples: [{ private: 'editorial' }],
      title: 'editorial',
    };
  schemasOf(data).ChatContentItems = { type: 'boolean' };
  schemasOf(data).ConfigurationUpdateReasoning = { type: 'string' };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const literal = { description: 'private literal', example: 'literal', title: 'literal' };
  schemasOf(data).ChatMessages = { ...historyShapes.ChatMessages, default: literal };
  assert.deepEqual(
    (projectOfficialSchema(data).definitions.ChatMessages as { default: unknown }).default,
    literal,
  );
  assert.equal(compareOfficialSchema(data, pinned), false);
  const named = source();
  schemasOf(named).ChatUserMessage = {
    ...historyShapes.ChatUserMessage,
    properties: { ...historyShapes.ChatUserMessage.properties, description: { type: 'string' } },
  };
  assert.equal(compareOfficialSchema(named, pinned), false);
});
test('missing or malformed history definitions fail safely', () => {
  for (const name of Object.keys(historyShapes))
    for (const value of [undefined, null, [], 'private malformed']) {
      const data = source();
      schemasOf(data)[name] = value;
      assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
    }
});
test('history exact definition maps reject rehashed absent extra malformed and version-16 pins', () => {
  assert.throws(() => validateSchemaPin({ ...pinned, version: 16 }), /Invalid schema pin/);
  for (const name of Object.keys(historyShapes))
    for (const operation of ['missing', 'extra', 'malformed']) {
      const definitions = { ...pinned.projection.definitions };
      if (operation === 'missing') delete definitions[name];
      if (operation === 'extra') definitions.unselected = { type: 'object' };
      if (operation === 'malformed') definitions[name] = [];
      const projection = { ...pinned.projection, definitions };
      const projectionSha256 = createHash('sha256')
        .update(canonicalSchema(projection))
        .digest('hex');
      assert.throws(
        () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
        /Invalid schema pin/,
      );
    }
});

test('reasoning request and referenced summary enum are selected exactly without defaults', () => {
  const projection = projectOfficialSchema(source());
  assert.deepEqual(projection.fields.reasoning, reasoningRequestShape);
  assert.deepEqual(projection.definitions.ChatReasoningSummaryVerbosityEnum, reasoningSummaryShape);
});
test('summary type enum null default extension and constraints cause drift without reference changes', () => {
  for (const replacement of [
    { ...reasoningSummaryShape, type: 'string' },
    { ...reasoningSummaryShape, type: ['number', 'null'] },
    { ...reasoningSummaryShape, enum: ['auto', 'concise', null] },
    { ...reasoningSummaryShape, enum: ['auto', 'concise', 'detailed'] },
    { ...reasoningSummaryShape, enum: [...reasoningSummaryShape.enum, 'unknown'] },
    { ...reasoningSummaryShape, default: 'auto' },
    { ...reasoningSummaryShape, 'x-speakeasy-unknown-values': 'reject' },
    { ...reasoningSummaryShape, maxLength: 10 },
  ]) {
    const data = source();
    schemasOf(data).ChatReasoningSummaryVerbosityEnum = replacement;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
});
test('inline reasoning object references required shape and effort drift stay visible', () => {
  for (const replacement of [
    { ...reasoningRequestShape, type: ['object', 'null'] },
    { ...reasoningRequestShape, required: ['summary'] },
    { ...reasoningRequestShape, additionalProperties: false },
    {
      ...reasoningRequestShape,
      properties: {
        ...reasoningRequestShape.properties,
        summary: { $ref: '#/components/schemas/Other' },
      },
    },
    {
      ...reasoningRequestShape,
      properties: { ...reasoningRequestShape.properties, effort: { type: 'integer' } },
    },
    { ...reasoningRequestShape, default: { summary: 'concise' } },
  ]) {
    const data = source();
    chatRequestProperties(data).reasoning = replacement;
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
  const data = source();
  (schemasOf(data).ChatRequest as { required: string[] }).required.push('reasoning');
  assert.equal(compareOfficialSchema(data, pinned), false);
});
test('reasoning summary annotations are ignored while annotation-named properties and literal defaults remain structural', () => {
  const data = source();
  chatRequestProperties(data).reasoning = {
    ...reasoningRequestShape,
    description: 'private editorial',
    examples: [{ summary: 'auto' }],
  };
  schemasOf(data).ChatReasoningSummaryVerbosityEnum = {
    ...reasoningSummaryShape,
    title: 'editorial',
    example: 'auto',
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  const literal = { description: 'literal', example: 'literal', title: 'literal' };
  schemasOf(data).ChatReasoningSummaryVerbosityEnum = {
    ...reasoningSummaryShape,
    default: literal,
  };
  assert.deepEqual(
    (
      projectOfficialSchema(data).definitions.ChatReasoningSummaryVerbosityEnum as {
        default: unknown;
      }
    ).default,
    literal,
  );
  assert.equal(compareOfficialSchema(data, pinned), false);
  const named = source();
  chatRequestProperties(named).reasoning = {
    ...reasoningRequestShape,
    properties: { ...reasoningRequestShape.properties, description: { type: 'string' } },
  };
  assert.equal(compareOfficialSchema(named, pinned), false);
});
test('missing or malformed reasoning request and summary definitions fail safely', () => {
  for (const value of [undefined, null, [], 'private source']) {
    const field = source();
    chatRequestProperties(field).reasoning = value;
    assert.throws(() => projectOfficialSchema(field), /Invalid official schema/);
    const definition = source();
    schemasOf(definition).ChatReasoningSummaryVerbosityEnum = value;
    assert.throws(() => projectOfficialSchema(definition), /Invalid official schema/);
  }
});
test('rehashed reasoning field and summary definition maps and old pins reject safely', () => {
  assert.throws(() => validateSchemaPin({ ...pinned, version: 17 }), /Invalid schema pin/);
  for (const [map, key] of [
    ['fields', 'reasoning'],
    ['definitions', 'ChatReasoningSummaryVerbosityEnum'],
  ] as const)
    for (const operation of ['missing', 'extra', 'malformed']) {
      const selection = { ...pinned.projection[map] };
      if (operation === 'missing') delete selection[key];
      if (operation === 'extra') selection.unselected = { type: 'string' };
      if (operation === 'malformed') selection[key] = [];
      const projection = { ...pinned.projection, [map]: selection };
      const projectionSha256 = createHash('sha256')
        .update(canonicalSchema(projection))
        .digest('hex');
      assert.throws(
        () => validateSchemaPin({ ...pinned, projection, projectionSha256 }),
        /Invalid schema pin/,
      );
    }
});

const fragmentShape = {
  type: 'object',
  required: ['index'],
  properties: {
    index: { type: 'integer' },
    id: { type: 'string' },
    type: { type: 'string', enum: ['function'] },
    function: {
      type: 'object',
      properties: { name: { type: 'string' }, arguments: { type: 'string' } },
    },
  },
};
function fragmentSource() {
  const data = source();
  const schemas = (data.components as { schemas: Record<string, unknown> }).schemas;
  schemas.ChatStreamToolCall = structuredClone(fragmentShape);
  return data;
}
test('selects the transitive function fragment target rather than only its parent reference', () => {
  const projected = projectOfficialSchema(fragmentSource());
  assert.deepEqual(projected.streamDefinitions.ChatStreamToolCall, fragmentShape);
  assert.deepEqual(
    Object.keys(projected.streamDefinitions).sort(),
    [
      'ChatStreamChunk',
      'ChatStreamChoice',
      'ChatStreamDelta',
      'ChatStreamOptions',
      'ChatStreamToolCall',
    ].sort(),
  );
});
test('unchanged parent references cannot hide nested function fragment drift', () => {
  for (const alter of [
    (shape: typeof fragmentShape) => {
      shape.required.push('id');
    },
    (shape: typeof fragmentShape) => {
      shape.properties.index.type = 'number';
    },
    (shape: typeof fragmentShape) => {
      shape.properties.id.type = 'integer';
    },
    (shape: typeof fragmentShape) => {
      shape.properties.type.enum.push('custom');
    },
    (shape: typeof fragmentShape) => {
      shape.properties.function.properties.name.type = 'integer';
    },
    (shape: typeof fragmentShape) => {
      shape.properties.function.properties.arguments.type = 'object';
    },
  ]) {
    const data = fragmentSource(),
      schemas = (data.components as { schemas: Record<string, unknown> }).schemas;
    alter(schemas.ChatStreamToolCall as typeof fragmentShape);
    assert.equal(compareOfficialSchema(data, pinned), false);
  }
});
test('function fragment annotations are ignored but malformed missing targets reject', () => {
  const data = fragmentSource(),
    schemas = (data.components as { schemas: Record<string, unknown> }).schemas;
  schemas.ChatStreamToolCall = {
    ...fragmentShape,
    description: 'editorial',
    example: { private: 'ignored' },
  };
  assert.equal(compareOfficialSchema(data, pinned), true);
  for (const value of [undefined, null, [], 42, 'private']) {
    const data = fragmentSource();
    (data.components as { schemas: Record<string, unknown> }).schemas.ChatStreamToolCall = value;
    assert.throws(() => projectOfficialSchema(data), /Invalid official schema/);
  }
});
