import { createHash } from 'node:crypto';
import { canonicalSchema, OFFICIAL_SCHEMA_URL, structuralSchema } from './openrouter-schema.ts';

const PATH = '/models/user';
const PARAMETERS = ['offset', 'limit', 'output_modalities', 'sort'] as const;
const DEFINITIONS = ['ModelsListResponse', 'ModelsListResponseData', 'Model'] as const;
const RESPONSE_REF = '#/components/schemas/ModelsListResponse';
export interface UserModelSchemaProjection {
  openapi: string;
  documentVersion: string;
  path: typeof PATH;
  method: 'get';
  operationId: string;
  parameters: Record<string, unknown>;
  security: Record<string, string[]>[];
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
function parameter(value: unknown, name: string): unknown {
  const entry = record(value);
  if (
    !entry ||
    entry.name !== name ||
    entry.in !== 'query' ||
    (Object.hasOwn(entry, 'required') && typeof entry.required !== 'boolean') ||
    Object.hasOwn(entry, '$ref') ||
    Object.hasOwn(entry, 'content')
  )
    throw Error();
  schema(entry.schema);
  return structuralSchema(entry);
}
// Security requirement keys and scope strings are literal OpenAPI values, not schema annotations.
function security(value: unknown): Record<string, string[]>[] {
  if (!Array.isArray(value)) throw Error();
  return value.map((entry: unknown) => {
    const requirement = record(entry);
    if (!requirement) throw Error();
    return Object.fromEntries(
      Object.entries(requirement).map(([name, scopes]) => {
        if (!Array.isArray(scopes) || scopes.some((scope: unknown) => typeof scope !== 'string'))
          throw Error();
        return [name, [...scopes]];
      }),
    );
  });
}
function projection(value: unknown): UserModelSchemaProjection {
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
      'security',
      'status',
      'mediaType',
      'schema',
      'definitions',
    ]) ||
    typeof data.openapi !== 'string' ||
    !data.openapi ||
    typeof data.documentVersion !== 'string' ||
    !data.documentVersion ||
    data.path !== PATH ||
    data.method !== 'get' ||
    typeof data.operationId !== 'string' ||
    !data.operationId ||
    data.status !== '200' ||
    data.mediaType !== 'application/json' ||
    !parameters ||
    !exactKeys(parameters, PARAMETERS) ||
    !definitions ||
    !exactKeys(definitions, DEFINITIONS)
  )
    throw Error();
  return {
    openapi: data.openapi,
    documentVersion: data.documentVersion,
    path: PATH,
    method: 'get',
    operationId: data.operationId,
    parameters: Object.fromEntries(
      PARAMETERS.map((name) => [name, parameter(parameters[name], name)]),
    ),
    security: security(data.security),
    status: '200',
    mediaType: 'application/json',
    schema: schema(data.schema),
    definitions: Object.fromEntries(DEFINITIONS.map((name) => [name, schema(definitions[name])])),
  };
}
export function projectOfficialUserModelSchema(value: unknown): UserModelSchemaProjection {
  try {
    const data = record(value);
    const path = record(record(data?.paths)?.[PATH]);
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
            return !p || PARAMETERS.some((name) => name === p.name);
          })))
    )
      throw Error();
    const parameters: Record<string, unknown> = {};
    for (const name of PARAMETERS) {
      const matching = entries.filter((entry) => record(entry)?.name === name);
      if (matching.length !== 1) throw Error();
      parameters[name] = matching[0];
    }
    const response = record(record(operation?.responses)?.['200']);
    const media = record(record(response?.content)?.['application/json']);
    const definitions = record(record(data?.components)?.schemas);
    if (!response || Object.hasOwn(response, '$ref') || !definitions) throw Error();
    return projection({
      openapi: data?.openapi,
      documentVersion: record(data?.info)?.version,
      path: PATH,
      method: 'get',
      operationId: operation?.operationId,
      parameters,
      security: operation?.security,
      status: '200',
      mediaType: 'application/json',
      schema: media?.schema,
      definitions: Object.fromEntries(DEFINITIONS.map((name) => [name, definitions[name]])),
    });
  } catch {
    throw new TypeError('Invalid official user-model schema');
  }
}
export function validateUserModelSchemaPin(value: unknown): {
  projection: UserModelSchemaProjection;
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
      checked.operationId !== 'listModelsUser' ||
      canonicalSchema(checked.security) !== canonicalSchema([{ bearer: [] }]) ||
      canonicalSchema(checked.schema) !== canonicalSchema({ $ref: RESPONSE_REF }) ||
      canonicalSchema(checked) !== canonicalSchema(data.projection)
    )
      throw Error();
    return { projection: checked };
  } catch {
    throw new TypeError('Invalid user-model schema pin');
  }
}
export function compareOfficialUserModelSchema(source: unknown, pin: unknown): boolean {
  return (
    canonicalSchema(projectOfficialUserModelSchema(source)) ===
    canonicalSchema(validateUserModelSchemaPin(pin).projection)
  );
}
