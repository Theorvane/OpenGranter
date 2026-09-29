import { createHash } from 'node:crypto';

export const OFFICIAL_SCHEMA_URL = 'https://openrouter.ai/openapi.json';
const REQUEST_REF = '#/components/schemas/ChatRequest';
const FIELD_NAMES = [
  'model',
  'messages',
  'stream',
  'max_tokens',
  'max_completion_tokens',
  'stop',
  'temperature',
  'top_p',
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
  required: readonly string[];
  fields: Record<string, unknown>;
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
  const required = data?.required;
  if (
    data?.openapi !== '3.1.0' ||
    typeof data.documentVersion !== 'string' ||
    !data.documentVersion ||
    data.requestRef !== REQUEST_REF ||
    !Array.isArray(required) ||
    required.some((item) => typeof item !== 'string' || !item) ||
    new Set(required).size !== required.length ||
    !fields ||
    Object.keys(fields).length !== FIELD_NAMES.length ||
    FIELD_NAMES.some((name) => !record(fields[name]))
  )
    throw new TypeError('Invalid official schema');
  return {
    openapi: data.openapi,
    documentVersion: data.documentVersion,
    requestRef: data.requestRef,
    required: [...required],
    fields: Object.fromEntries(FIELD_NAMES.map((name) => [name, ordered(fields[name], true)])),
  };
}
export function projectOfficialSchema(value: unknown): SchemaProjection {
  const data = record(value);
  const info = record(data?.info);
  const path = record(record(data?.paths)?.['/chat/completions']);
  const body = record(record(path?.post)?.requestBody);
  const media = record(record(body?.content)?.['application/json']);
  const ref = record(media?.schema)?.$ref;
  const schemas = record(record(data?.components)?.schemas);
  const request = record(schemas?.ChatRequest);
  const properties = record(request?.properties);
  if (!properties) throw new TypeError('Invalid official schema');
  return projection({
    openapi: data?.openapi,
    documentVersion: info?.version,
    requestRef: ref,
    required: request?.required,
    fields: Object.fromEntries(FIELD_NAMES.map((name) => [name, properties[name]])),
  });
}
export function validateSchemaPin(value: unknown): { projection: SchemaProjection } {
  try {
    const data = record(value);
    if (
      data?.version !== 1 ||
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
