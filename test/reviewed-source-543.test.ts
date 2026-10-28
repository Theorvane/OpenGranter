import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  compareOfficialModelResponseSchema,
  validateModelResponseSchemaPin,
} from '../scripts/openrouter-model-response-schema.ts';
import { canonicalSchema } from '../scripts/openrouter-schema.ts';

const pin = JSON.parse(
  await readFile(
    new URL('../contracts/openrouter-model-response-schema.json', import.meta.url),
    'utf8',
  ),
);
const fields = [
  ['DefaultParameters', 'frequency_penalty', 'number'],
  ['DefaultParameters', 'presence_penalty', 'number'],
  ['DefaultParameters', 'repetition_penalty', 'number'],
  ['DefaultParameters', 'temperature', 'number'],
  ['DefaultParameters', 'top_p', 'number'],
  ['TopProviderInfo', 'context_length', 'integer'],
  ['TopProviderInfo', 'max_completion_tokens', 'integer'],
] as const;
const hash = (value: unknown) => createHash('sha256').update(canonicalSchema(value)).digest('hex');
function currentProjection() {
  const p = structuredClone(pin.projection);
  for (const [name, field] of fields) delete p.definitions[name].properties[field].nullable;
  return p;
}
function source() {
  const p = currentProjection();
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
test('reviewed response v4 records fresh provenance and exact captured projection', () => {
  assert.equal(pin.version, 4);
  assert.equal(pin.retrievedAt, '2026-10-27');
  assert.equal(
    pin.sourceSha256,
    'd211bd20aa7a7a7eac1c0f6deadf19417f8acd9a03ff51ec07ecda9194051e2e',
  );
  assert.equal(
    pin.projectionSha256,
    '5d8b334d04ca90d1c4d1b587771b12f135a56c78dd9d532661dd60202d55b6af',
  );
  assert.equal(hash(pin.projection), pin.projectionSha256);
  assert.equal(compareOfficialModelResponseSchema(source(), pin), true);
});
for (const [name, field, type] of fields) {
  test(`${name}.${field}: reviewed marker removal preserves complete type and optionality`, () => {
    assert.deepEqual(pin.projection.definitions[name].properties[field], {
      type: [type, 'null'],
      ...(type === 'number' ? { format: 'double' } : {}),
    });
    assert.equal((pin.projection.definitions[name].required ?? []).includes(field), false);
  });
  test(`${name}.${field}: marker restoration/change and null-type removal remain structural`, () => {
    for (const nullable of [true, false, null, 'true']) {
      const s = source();
      s.components.schemas[name].properties[field].nullable = nullable;
      assert.equal(compareOfficialModelResponseSchema(s, pin), false);
    }
    const s = source();
    s.components.schemas[name].properties[field].type = type;
    assert.equal(compareOfficialModelResponseSchema(s, pin), false);
  });
}
test('restoring exactly seven markers reconstructs the complete reviewed v3 digest', () => {
  const previous = currentProjection();
  for (const [name, field] of fields) previous.definitions[name].properties[field].nullable = true;
  assert.equal(hash(previous), '825714729401e81ab4a6196b7a8ed6b76d89a32c09869d02a18e812276ced87b');
  assert.throws(
    () =>
      validateModelResponseSchemaPin({
        ...pin,
        version: 3,
        projection: previous,
        projectionSha256: hash(previous),
      }),
    { message: 'Invalid model-response schema pin' },
  );
});
for (const version of [1, 2, 3])
  test(`version ${version} remains stale even with correctly rehashed current source structures`, () => {
    const projection = currentProjection();
    assert.throws(
      () =>
        validateModelResponseSchemaPin({
          ...pin,
          version,
          projection,
          projectionSha256: hash(projection),
        }),
      { message: 'Invalid model-response schema pin' },
    );
  });
