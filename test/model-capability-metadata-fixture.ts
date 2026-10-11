import assert from 'node:assert/strict';
import {
  type discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';
export const capabilityFields = {
  reasoning: {
    mandatory: true,
    default_enabled: false,
    default_effort: 'high',
    supported_efforts: ['high', null, 'catalog-private-future', 'high'],
    supports_max_tokens: true,
  },
  alias_target: { slug: 'catalog-private/source', name: 'catalog-private original' },
};
export function capabilityModel(extra: Record<string, unknown> = capabilityFields, alias = 'one') {
  const model = discoveryModel(alias);
  assert.ok(model.openRouterMetadata);
  Object.assign(model.openRouterMetadata, structuredClone(extra));
  return model;
}
export function capabilityPrivacy(f: ReturnType<typeof discoveryFixture>) {
  discoveryPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /catalog-private|reasoning|mandatory|default_effort|supported_efforts|alias_target/u,
  );
}
