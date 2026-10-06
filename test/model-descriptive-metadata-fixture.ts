import assert from 'node:assert/strict';
import {
  type discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

export const descriptiveFields = {
  description: 'descriptive-private: exact\n model information 😀 <b>text</b>',
  expiration_date: '2000-01-01',
  knowledge_cutoff: '2024-06-01',
};
export function descriptiveModel(
  extra: Record<string, unknown> = descriptiveFields,
  alias = 'one',
) {
  const model = discoveryModel(alias);
  assert.ok(model.openRouterMetadata);
  Object.assign(model.openRouterMetadata, extra);
  return model;
}
export function descriptivePrivacy(f: ReturnType<typeof discoveryFixture>) {
  discoveryPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /descriptive-private|description|expiration_date|knowledge_cutoff|2000-01-01|2024-06-01/u,
  );
}
