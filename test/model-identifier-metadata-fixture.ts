import assert from 'node:assert/strict';
import {
  type discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

export const identifierValues = {
  hugging_face_id: 'catalog-private/opaque-model',
  tokenizer: 'GPT',
  instruct_type: 'chatml',
};
export const identifierFields = ['hugging_face_id', 'tokenizer', 'instruct_type'] as const;
export type IdentifierField = (typeof identifierFields)[number];
export function identifierModel(
  values: Partial<Record<IdentifierField, unknown>> = identifierValues,
  alias = 'one',
) {
  const model = discoveryModel(alias);
  assert.ok(model.openRouterMetadata);
  for (const field of identifierFields)
    if (Object.hasOwn(values, field))
      Object.assign(
        field === 'hugging_face_id'
          ? model.openRouterMetadata
          : model.openRouterMetadata.architecture,
        { [field]: values[field] },
      );
  return model;
}
export function identifierContainer(
  row: Record<string, unknown>,
  field: IdentifierField,
): Record<string, unknown> {
  return field === 'hugging_face_id' ? row : (row.architecture as Record<string, unknown>);
}
export function identifierPrivacy(f: ReturnType<typeof discoveryFixture>) {
  discoveryPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /catalog-private|hugging_face_id|tokenizer|instruct_type/u,
  );
}
