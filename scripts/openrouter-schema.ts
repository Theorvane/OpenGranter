import { createHash } from 'node:crypto';

export const OFFICIAL_SCHEMA_URL = 'https://openrouter.ai/openapi.json';
const REQUEST_REF = '#/components/schemas/ChatRequest';
const RESPONSE_REF = '#/components/schemas/ChatResult';
const RESPONSE_DEFINITION_NAMES = [
  'ChatResult',
  'ChatChoice',
  'ChatAssistantMessage',
  'ChatTokenLogprobs',
  'ChatTokenLogprob',
] as const;
const REASONING_DEFINITION_NAMES = [
  'ChatReasoningDetails',
  'ChatStreamReasoningDetails',
  'ReasoningDetailUnion',
  'ReasoningDetailSummary',
  'ReasoningDetailEncrypted',
  'ReasoningDetailText',
  'ReasoningDetailServerToolCall',
  'ReasoningFormat',
] as const;
const USAGE_DEFINITION_NAMES = ['ChatUsage', 'CostDetails', 'ServerToolUseDetails'] as const;
const FIELD_NAMES = [
  'model',
  'messages',
  'user',
  'prompt_cache_key',
  'metadata',
  'cache_control',
  'stream',
  'stream_options',
  'max_tokens',
  'max_completion_tokens',
  'stop',
  'temperature',
  'top_p',
  'min_p',
  'top_a',
  'repetition_penalty',
  'reasoning_effort',
  'reasoning',
  'response_format',
  'frequency_penalty',
  'presence_penalty',
  'seed',
  'top_k',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
] as const;
const DEFINITION_NAMES = [
  'AnthropicCacheControlDirective',
  'AnthropicCacheControlTtl',
  'ChatMessages',
  'ChatSystemMessage',
  'ChatDeveloperMessage',
  'ChatUserMessage',
  'ChatReasoningSummaryVerbosityEnum',
  'ChatFinishReasonEnum',
  'ChatFormatTextConfig',
  'ChatFormatJsonObjectConfig',
  'ChatFormatJsonSchemaConfig',
  'ChatJsonSchemaConfig',
  'ChatFunctionTool',
  'ChatToolChoice',
  'ChatNamedToolChoice',
  'ChatToolCall',
] as const;
const STREAM_DEFINITION_NAMES = [
  'ChatStreamChunk',
  'ChatStreamChoice',
  'ChatStreamDelta',
  'ChatStreamOptions',
  'ChatStreamToolCall',
] as const;
const MESSAGE_NAMES = [
  'ChatSystemMessage',
  'ChatDeveloperMessage',
  'ChatUserMessage',
  'ChatAssistantMessage',
] as const;
const ANNOTATIONS = new Set([
  'description',
  'example',
  'examples',
  'title',
  'externalDocs',
  '$comment',
]);

export interface SchemaProjection {
  openapi: string;
  documentVersion: string;
  requestRef: string;
  responseRef: string;
  responseDefinitions: Record<string, unknown>;
  usageDefinitions: Record<string, unknown>;
  reasoningDefinitions: Record<string, unknown>;
  required: readonly string[];
  fields: Record<string, unknown>;
  definitions: Record<string, unknown>;
  streamDefinitions: Record<string, unknown>;
  messageNames: Record<string, unknown>;
  toolMessages: Record<string, unknown>;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function ordered(value: unknown, strip: boolean, depth = 0, names = false): unknown {
  if (depth > 64) throw new TypeError('Invalid official schema');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => ordered(item, strip, depth + 1));
  const object = record(value);
  if (!object) throw new TypeError('Invalid official schema');
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .filter((key) => !strip || names || !ANNOTATIONS.has(key))
      .map((key) => [
        key,
        ordered(
          object[key],
          strip && (names || !['default', 'const', 'enum'].includes(key)),
          depth + 1,
          strip &&
            !names &&
            [
              'properties',
              'patternProperties',
              '$defs',
              'definitions',
              'dependentSchemas',
            ].includes(key),
        ),
      ]),
  );
}
export function canonicalSchema(value: unknown): string {
  return JSON.stringify(ordered(value, false));
}
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function projection(value: unknown): SchemaProjection {
  const data = record(value);
  const fields = record(data?.fields);
  const definitions = record(data?.definitions);
  const responseDefinitions = record(data?.responseDefinitions);
  const usageDefinitions = record(data?.usageDefinitions);
  const reasoningDefinitions = record(data?.reasoningDefinitions);
  const streamDefinitions = record(data?.streamDefinitions);
  const messageNames = record(data?.messageNames);
  const toolMessages = record(data?.toolMessages);
  const required = data?.required;
  if (
    data?.openapi !== '3.1.0' ||
    typeof data.documentVersion !== 'string' ||
    !data.documentVersion ||
    data.requestRef !== REQUEST_REF ||
    data.responseRef !== RESPONSE_REF ||
    !responseDefinitions ||
    Object.keys(responseDefinitions).length !== RESPONSE_DEFINITION_NAMES.length ||
    RESPONSE_DEFINITION_NAMES.some((name) => !record(responseDefinitions[name])) ||
    !reasoningDefinitions ||
    Object.keys(reasoningDefinitions).length !== REASONING_DEFINITION_NAMES.length ||
    REASONING_DEFINITION_NAMES.some((name) => !record(reasoningDefinitions[name])) ||
    !usageDefinitions ||
    Object.keys(usageDefinitions).length !== USAGE_DEFINITION_NAMES.length ||
    USAGE_DEFINITION_NAMES.some((name) => !record(usageDefinitions[name])) ||
    !Array.isArray(required) ||
    required.some((item) => typeof item !== 'string' || !item) ||
    new Set(required).size !== required.length ||
    !fields ||
    Object.keys(fields).length !== FIELD_NAMES.length ||
    FIELD_NAMES.some((name) => !record(fields[name])) ||
    !definitions ||
    Object.keys(definitions).length !== DEFINITION_NAMES.length ||
    DEFINITION_NAMES.some((name) => !record(definitions[name])) ||
    !streamDefinitions ||
    Object.keys(streamDefinitions).length !== STREAM_DEFINITION_NAMES.length ||
    STREAM_DEFINITION_NAMES.some((name) => !record(streamDefinitions[name])) ||
    !messageNames ||
    Object.keys(messageNames).length !== MESSAGE_NAMES.length ||
    MESSAGE_NAMES.some((name) => {
      const entry = record(messageNames[name]);
      return (
        !entry ||
        Object.keys(entry).length !== 2 ||
        !record(entry.schema) ||
        typeof entry.required !== 'boolean'
      );
    }) ||
    !toolMessages ||
    Object.keys(toolMessages).length !== 2 ||
    !record(record(toolMessages.ChatAssistantMessage)?.schema) ||
    typeof record(toolMessages.ChatAssistantMessage)?.required !== 'boolean' ||
    !record(toolMessages.ChatToolMessage)
  )
    throw new TypeError('Invalid official schema');
  return {
    openapi: data.openapi,
    documentVersion: data.documentVersion,
    requestRef: data.requestRef,
    responseRef: data.responseRef,
    responseDefinitions: Object.fromEntries(
      RESPONSE_DEFINITION_NAMES.map((name) => [name, ordered(responseDefinitions[name], true)]),
    ),
    usageDefinitions: Object.fromEntries(
      USAGE_DEFINITION_NAMES.map((name) => [name, ordered(usageDefinitions[name], true)]),
    ),
    reasoningDefinitions: Object.fromEntries(
      REASONING_DEFINITION_NAMES.map((name) => [name, ordered(reasoningDefinitions[name], true)]),
    ),
    required: [...required],
    fields: Object.fromEntries(FIELD_NAMES.map((name) => [name, ordered(fields[name], true)])),
    definitions: Object.fromEntries(
      DEFINITION_NAMES.map((name) => [name, ordered(definitions[name], true)]),
    ),
    streamDefinitions: Object.fromEntries(
      STREAM_DEFINITION_NAMES.map((name) => [name, ordered(streamDefinitions[name], true)]),
    ),
    messageNames: Object.fromEntries(
      MESSAGE_NAMES.map((name) => [name, ordered(messageNames[name], true)]),
    ),
    toolMessages: Object.fromEntries(
      ['ChatAssistantMessage', 'ChatToolMessage'].map((name) => [
        name,
        ordered(toolMessages[name], true),
      ]),
    ),
  };
}
export function projectOfficialSchema(value: unknown): SchemaProjection {
  const data = record(value);
  const info = record(data?.info);
  const path = record(record(data?.paths)?.['/chat/completions']);
  const body = record(record(path?.post)?.requestBody);
  const media = record(record(body?.content)?.['application/json']);
  const ref = record(media?.schema)?.$ref;
  const response = record(record(record(path?.post)?.responses)?.['200']);
  const responseMedia = record(record(response?.content)?.['application/json']);
  const schemas = record(record(data?.components)?.schemas);
  const request = record(schemas?.ChatRequest);
  const properties = record(request?.properties);
  if (!properties) throw new TypeError('Invalid official schema');
  return projection({
    openapi: data?.openapi,
    documentVersion: info?.version,
    requestRef: ref,
    responseRef: record(responseMedia?.schema)?.$ref,
    responseDefinitions: Object.fromEntries(
      RESPONSE_DEFINITION_NAMES.map((name) => [name, schemas?.[name]]),
    ),
    usageDefinitions: Object.fromEntries(
      USAGE_DEFINITION_NAMES.map((name) => [name, schemas?.[name]]),
    ),
    reasoningDefinitions: Object.fromEntries(
      REASONING_DEFINITION_NAMES.map((name) => [name, schemas?.[name]]),
    ),
    required: request?.required,
    fields: Object.fromEntries(FIELD_NAMES.map((name) => [name, properties[name]])),
    definitions: Object.fromEntries(DEFINITION_NAMES.map((name) => [name, schemas?.[name]])),
    streamDefinitions: Object.fromEntries(
      STREAM_DEFINITION_NAMES.map((name) => [name, schemas?.[name]]),
    ),
    messageNames: Object.fromEntries(
      MESSAGE_NAMES.map((name) => {
        const message = record(schemas?.[name]);
        const required = message?.required === undefined ? [] : message.required;
        const schema = record(record(message?.properties)?.name);
        if (
          message?.type !== 'object' ||
          !schema ||
          !Array.isArray(required) ||
          required.some((field) => typeof field !== 'string' || !field) ||
          new Set(required).size !== required.length
        )
          throw new TypeError('Invalid official schema');
        return [name, { schema, required: required.includes('name') }];
      }),
    ),
    toolMessages: (() => {
      const assistant = record(schemas?.ChatAssistantMessage);
      const tool = record(schemas?.ChatToolMessage);
      const assistantRequired = assistant?.required === undefined ? [] : assistant.required;
      const toolRequired = tool?.required;
      const calls = record(record(assistant?.properties)?.tool_calls);
      if (
        assistant?.type !== 'object' ||
        tool?.type !== 'object' ||
        !Array.isArray(assistantRequired) ||
        assistantRequired.some((name) => typeof name !== 'string' || !name) ||
        new Set(assistantRequired).size !== assistantRequired.length ||
        !calls ||
        !Array.isArray(toolRequired) ||
        toolRequired.some((name) => typeof name !== 'string' || !name) ||
        new Set(toolRequired).size !== toolRequired.length ||
        !record(tool.properties)
      )
        throw new TypeError('Invalid official schema');
      return {
        ChatAssistantMessage: { schema: calls, required: assistantRequired.includes('tool_calls') },
        ChatToolMessage: tool,
      };
    })(),
  });
}
export function validateSchemaPin(value: unknown): { projection: SchemaProjection } {
  try {
    const data = record(value);
    if (
      data?.version !== 24 ||
      data.source !== OFFICIAL_SCHEMA_URL ||
      typeof data.retrievedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.retrievedAt) ||
      !Number.isFinite(Date.parse(data.retrievedAt)) ||
      typeof data.sourceSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.sourceSha256) ||
      typeof data.projectionSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.projectionSha256) ||
      digest(canonicalSchema(data.projection)) !== data.projectionSha256
    )
      throw new Error();
    const checked = projection(data.projection);
    if (canonicalSchema(checked) !== canonicalSchema(data.projection)) throw new Error();
    return { projection: checked };
  } catch {
    throw new TypeError('Invalid schema pin');
  }
}
export function compareOfficialSchema(source: unknown, pin: unknown): boolean {
  return (
    canonicalSchema(projectOfficialSchema(source)) ===
    canonicalSchema(validateSchemaPin(pin).projection)
  );
}
export async function fetchOfficialSchema(
  fetcher: typeof fetch = fetch,
  timeoutMs = 10000,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error();
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error());
      }, timeoutMs);
    });
    const download = async () => {
      const response = await fetcher(OFFICIAL_SCHEMA_URL, {
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > 8 * 1024 * 1024) throw new Error();
          chunks.push(next.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } finally {
        await reader.cancel().catch(() => {});
      }
    };
    return await Promise.race([download(), deadline]);
  } catch {
    throw new Error('Official schema unavailable');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
