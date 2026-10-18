import { createHash } from 'node:crypto';
import { canonicalSchema, OFFICIAL_SCHEMA_URL, structuralSchema } from './openrouter-schema.ts';

const RESPONSE_REF = '#/components/schemas/ModelsCountResponse';
const PARAMETER = 'output_modalities';
const DEFINITION = 'ModelsCountResponse';
export interface ModelCountSchemaProjection {
  openapi: string;
  documentVersion: string;
  path: '/models/count';
  method: 'get';
  operationId: string;
  parameters: Record<string, unknown>;
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
function digest(value: unknown): string {
  return createHash('sha256').update(canonicalSchema(value)).digest('hex');
}
function schema(value: unknown): unknown {
  const data = record(value);
  if (
    !data ||
    Object.keys(data).length === 0 ||
    (Object.hasOwn(data, '$ref') && (typeof data.$ref !== 'string' || !data.$ref))
  )
    throw Error();
  const normalized = record(structuralSchema(data));
  if (!normalized || Object.keys(normalized).length === 0) throw Error();
  return normalized;
}
function parameter(value: unknown): unknown {
  const entry = record(value);
  if (
    !entry ||
    entry.name !== PARAMETER ||
    entry.in !== 'query' ||
    (Object.hasOwn(entry, 'required') && typeof entry.required !== 'boolean') ||
    Object.hasOwn(entry, '$ref') ||
    Object.hasOwn(entry, 'content')
  )
    throw Error();
  schema(entry.schema);
  return structuralSchema(entry);
}
function projection(value: unknown): ModelCountSchemaProjection {
  const data = record(value);
  const parameters = record(data?.parameters);
  const definitions = record(data?.definitions);
  if (
    !data ||
    !exactKeys(data, [
      'openapi',
      'documentVersion',
      'path',
      'method',
      'operationId',
      'parameters',
      'status',
      'mediaType',
      'schema',
      'definitions',
    ]) ||
    typeof data.openapi !== 'string' ||
    !data.openapi ||
    typeof data.documentVersion !== 'string' ||
    !data.documentVersion ||
    data.path !== '/models/count' ||
    data.method !== 'get' ||
    typeof data.operationId !== 'string' ||
    !data.operationId ||
    data.status !== '200' ||
    data.mediaType !== 'application/json' ||
    !parameters ||
    !exactKeys(parameters, [PARAMETER]) ||
    !definitions ||
    !exactKeys(definitions, [DEFINITION])
  )
    throw Error();
  return {
    openapi: data.openapi,
    documentVersion: data.documentVersion,
    path: data.path,
    method: data.method,
    operationId: data.operationId,
    parameters: { [PARAMETER]: parameter(parameters[PARAMETER]) },
    status: data.status,
    mediaType: data.mediaType,
    schema: schema(data.schema),
    definitions: { [DEFINITION]: schema(definitions[DEFINITION]) },
  };
}
export function projectOfficialModelCountSchema(value: unknown): ModelCountSchemaProjection {
  try {
    const data = record(value);
    const path = record(record(data?.paths)?.['/models/count']);
    const operation = record(path?.get);
    const entries = operation?.parameters;
    const inherited = path?.parameters;
    if (
      !Array.isArray(entries) ||
      entries.some((entry) => !record(entry)) ||
      (inherited !== undefined &&
        (!Array.isArray(inherited) ||
          inherited.some((entry) => {
            const p = record(entry);
            return !p || p.name === PARAMETER;
          })))
    )
      throw Error();
    const matching = entries.filter((entry) => record(entry)?.name === PARAMETER);
    if (matching.length !== 1) throw Error();
    const response = record(record(operation?.responses)?.['200']);
    const media = record(record(response?.content)?.['application/json']);
    const definitions = record(record(data?.components)?.schemas);
    if (!response || Object.hasOwn(response, '$ref') || !definitions) throw Error();
    return projection({
      openapi: data?.openapi,
      documentVersion: record(data?.info)?.version,
      path: '/models/count',
      method: 'get',
      operationId: operation?.operationId,
      parameters: { [PARAMETER]: matching[0] },
      status: '200',
      mediaType: 'application/json',
      schema: media?.schema,
      definitions: { [DEFINITION]: definitions[DEFINITION] },
    });
  } catch {
    throw new TypeError('Invalid official model-count schema');
  }
}
export function validateModelCountSchemaPin(value: unknown): {
  projection: ModelCountSchemaProjection;
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
      !/^\d{4}-\d{2}-\d{2}$/u.test(data.retrievedAt) ||
      !Number.isFinite(Date.parse(data.retrievedAt)) ||
      new Date(data.retrievedAt).toISOString().slice(0, 10) !== data.retrievedAt ||
      typeof data.sourceSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(data.sourceSha256) ||
      typeof data.projectionSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(data.projectionSha256) ||
      digest(data.projection) !== data.projectionSha256
    )
      throw Error();
    const checked = projection(data.projection);
    if (
      checked.openapi !== '3.1.0' ||
      checked.operationId !== 'listModelsCount' ||
      canonicalSchema(checked.schema) !== canonicalSchema({ $ref: RESPONSE_REF }) ||
      canonicalSchema(checked) !== canonicalSchema(data.projection)
    )
      throw Error();
    return { projection: checked };
  } catch {
    throw new TypeError('Invalid model-count schema pin');
  }
}
export function compareOfficialModelCountSchema(source: unknown, pin: unknown): boolean {
  return (
    canonicalSchema(projectOfficialModelCountSchema(source)) ===
    canonicalSchema(validateModelCountSchemaPin(pin).projection)
  );
}
