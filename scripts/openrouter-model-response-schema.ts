import { createHash } from 'node:crypto';
import { canonicalSchema, OFFICIAL_SCHEMA_URL, structuralSchema } from './openrouter-schema.ts';

const DEFINITION_NAMES = [
  'ModelsListResponse',
  'ModelsListResponseData',
  'Model',
  'ModelAliasTarget',
  'ModelArchitecture',
  'InputModality',
  'InstructType',
  'OutputModality',
  'ModelGroup',
  'ModelBenchmarks',
  'AABenchmarkEntry',
  'DABenchmarkEntry',
  'DefaultParameters',
  'ModelLinks',
  'PerRequestLimits',
  'PublicPricing',
  'PricingOverride',
  'ModelReasoning',
  'ReasoningEffort',
  'Parameter',
  'TopProviderInfo',
] as const;
const RESPONSE_REF = '#/components/schemas/ModelsListResponse';
export interface ModelResponseSchemaProjection {
  openapi: string;
  documentVersion: string;
  path: '/models';
  method: 'get';
  operationId: string;
  status: '200';
  mediaType: 'application/json';
  schema: unknown;
  definitions: Record<string, unknown>;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function schema(value: unknown): unknown {
  const data = record(value);
  if (!data || Object.keys(data).length === 0) throw new Error();
  if (Object.hasOwn(data, '$ref') && (typeof data.$ref !== 'string' || !data.$ref))
    throw new Error();
  const normalized = record(structuralSchema(data));
  if (!normalized || Object.keys(normalized).length === 0) throw new Error();
  return normalized;
}
function projection(value: unknown): ModelResponseSchemaProjection {
  const data = record(value);
  const definitions = record(data?.definitions);
  if (
    !data ||
    !exactKeys(data, [
      'openapi',
      'documentVersion',
      'path',
      'method',
      'operationId',
      'status',
      'mediaType',
      'schema',
      'definitions',
    ]) ||
    typeof data.openapi !== 'string' ||
    !data.openapi ||
    typeof data.documentVersion !== 'string' ||
    !data.documentVersion ||
    data.path !== '/models' ||
    data.method !== 'get' ||
    typeof data.operationId !== 'string' ||
    !data.operationId ||
    data.status !== '200' ||
    data.mediaType !== 'application/json' ||
    !definitions ||
    !exactKeys(definitions, DEFINITION_NAMES)
  )
    throw new Error();
  return {
    openapi: data.openapi,
    documentVersion: data.documentVersion,
    path: data.path,
    method: data.method,
    operationId: data.operationId,
    status: data.status,
    mediaType: data.mediaType,
    schema: schema(data.schema),
    definitions: Object.fromEntries(
      DEFINITION_NAMES.map((name) => [name, schema(definitions[name])]),
    ),
  };
}
export function projectOfficialModelResponseSchema(value: unknown): ModelResponseSchemaProjection {
  try {
    const data = record(value);
    const operation = record(record(record(data?.paths)?.['/models'])?.get);
    const response = record(record(operation?.responses)?.['200']);
    const media = record(record(response?.content)?.['application/json']);
    const schemas = record(record(data?.components)?.schemas);
    if (!schemas || !response || Object.hasOwn(response, '$ref')) throw new Error();
    return projection({
      openapi: data?.openapi,
      documentVersion: record(data?.info)?.version,
      path: '/models',
      method: 'get',
      operationId: operation?.operationId,
      status: '200',
      mediaType: 'application/json',
      schema: media?.schema,
      definitions: Object.fromEntries(DEFINITION_NAMES.map((name) => [name, schemas[name]])),
    });
  } catch {
    throw new TypeError('Invalid official model-response schema');
  }
}
export function validateModelResponseSchemaPin(value: unknown): {
  projection: ModelResponseSchemaProjection;
} {
  try {
    const data = record(value);
    if (
      !data ||
      !exactKeys(data, [
        'version',
        'source',
        'retrievedAt',
        'sourceSha256',
        'projectionSha256',
        'projection',
      ]) ||
      data.version !== 1 ||
      data.source !== OFFICIAL_SCHEMA_URL ||
      typeof data.retrievedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.retrievedAt) ||
      !Number.isFinite(Date.parse(data.retrievedAt)) ||
      new Date(data.retrievedAt).toISOString().slice(0, 10) !== data.retrievedAt ||
      typeof data.sourceSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.sourceSha256) ||
      typeof data.projectionSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.projectionSha256) ||
      createHash('sha256').update(canonicalSchema(data.projection)).digest('hex') !==
        data.projectionSha256
    )
      throw new Error();
    const checked = projection(data.projection);
    if (
      checked.openapi !== '3.1.0' ||
      checked.operationId !== 'getModels' ||
      canonicalSchema(checked.schema) !== canonicalSchema({ $ref: RESPONSE_REF }) ||
      canonicalSchema(checked) !== canonicalSchema(data.projection)
    )
      throw new Error();
    return { projection: checked };
  } catch {
    throw new TypeError('Invalid model-response schema pin');
  }
}
export function compareOfficialModelResponseSchema(source: unknown, pin: unknown): boolean {
  return (
    canonicalSchema(projectOfficialModelResponseSchema(source)) ===
    canonicalSchema(validateModelResponseSchemaPin(pin).projection)
  );
}
