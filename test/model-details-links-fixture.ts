import assert from 'node:assert/strict';
import {
  type discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

export const relativeDetails = '/api/v1/models/fixture/model-link-private/endpoints';
export function detailsModel(
  details: unknown = relativeDetails,
  alias = 'one',
  kind: 'managed' | 'delegated' = 'managed',
) {
  const model = discoveryModel(alias, { kind });
  assert.ok(model.openRouterMetadata);
  Object.assign(model.openRouterMetadata, { links: { details } });
  return model;
}
export function detailsPrivacy(f: ReturnType<typeof discoveryFixture>) {
  discoveryPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /model-link-private|"details"|\/endpoints|catalog\.example/u,
  );
}
