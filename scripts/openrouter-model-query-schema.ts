import { createHash } from 'node:crypto';
import { canonicalSchema, OFFICIAL_SCHEMA_URL, structuralSchema } from './openrouter-schema.ts';

const PARAMETER_NAMES = [
  'offset',
  'limit',
  'output_modalities',
  'supported_parameters',
  'context',
] as const;

export interface ModelQuerySchemaProjection {
  openapi: string;
  documentVersion: string;
  path: '/models';
  method: 'get';
  operationId: string;
  parameters: Record<string, unknown>;
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
function parameter(value: unknown, name: string): unknown {
  const entry = record(value);
  if (
    !entry ||
    entry.name !== name ||
    entry.in !== 'query' ||
    (Object.hasOwn(entry, 'required') && typeof entry.required !== 'boolean') ||
    !record(entry.schema) ||
    Object.hasOwn(entry, '$ref') ||
    Object.hasOwn(entry, 'content')
  )
    throw new Error();
  return structuralSchema(entry);
}
function projection(value: unknown): ModelQuerySchemaProjection {
  const data = record(value);
  const parameters = record(data?.parameters);
  if (
    !data ||
    !exactKeys(data, [
      'openapi',
      'documentVersion',
      'path',
      'method',
      'operationId',
      'parameters',
    ]) ||
    typeof data.openapi !== 'string' ||
    !data.openapi ||
    typeof data.documentVersion !== 'string' ||
    !data.documentVersion ||
    data.path !== '/models' ||
    data.method !== 'get' ||
    typeof data.operationId !== 'string' ||
    !data.operationId ||
    !parameters ||
    !exactKeys(parameters, PARAMETER_NAMES)
  )
    throw new Error();
  return {
    openapi: data.openapi,
    documentVersion: data.documentVersion,
    path: data.path,
    method: data.method,
    operationId: data.operationId,
    parameters: Object.fromEntries(
      PARAMETER_NAMES.map((name) => [name, parameter(parameters[name], name)]),
    ),
  };
}

export function projectOfficialModelQuerySchema(value: unknown): ModelQuerySchemaProjection {
  try {
    const data = record(value);
    const info = record(data?.info);
    const path = record(record(data?.paths)?.['/models']);
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
            return !p || PARAMETER_NAMES.some((name) => p.name === name);
          })))
    )
      throw new Error();
    const parameters = Object.fromEntries(
      PARAMETER_NAMES.map((name) => {
        const matching = entries.filter((entry) => record(entry)?.name === name);
        if (matching.length !== 1) throw new Error();
        return [name, matching[0]];
      }),
    );
    return projection({
      openapi: data?.openapi,
      documentVersion: info?.version,
      path: '/models',
      method: 'get',
      operationId: operation?.operationId,
      parameters,
    });
  } catch {
    throw new TypeError('Invalid official model-query schema');
  }
}

export function validateModelQuerySchemaPin(value: unknown): {
  projection: ModelQuerySchemaProjection;
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
      digest(data.projection) !== data.projectionSha256
    )
      throw new Error();
    const checked = projection(data.projection);
    if (
      checked.openapi !== '3.1.0' ||
      checked.operationId !== 'getModels' ||
      canonicalSchema(checked) !== canonicalSchema(data.projection)
    )
      throw new Error();
    return { projection: checked };
  } catch {
    throw new TypeError('Invalid model-query schema pin');
  }
}

export function compareOfficialModelQuerySchema(source: unknown, pin: unknown): boolean {
  return (
    canonicalSchema(projectOfficialModelQuerySchema(source)) ===
    canonicalSchema(validateModelQuerySchemaPin(pin).projection)
  );
}
