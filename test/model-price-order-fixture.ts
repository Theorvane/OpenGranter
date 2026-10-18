import assert from 'node:assert/strict';
import {
  type discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

export const priceSorts = ['pricing-low-to-high', 'pricing-high-to-low'] as const;
export type PriceSort = (typeof priceSorts)[number];
export function pricedModel(
  alias: string,
  prompt: string,
  completion: string,
  kind: 'managed' | 'delegated' = 'managed',
) {
  const model = discoveryModel(alias, { name: `Price ${alias}`, kind });
  assert.ok(model.openRouterMetadata);
  Object.assign(model.openRouterMetadata, { pricing: { prompt, completion } });
  return model;
}
export function priceOrderCatalog(kind: 'managed' | 'delegated' = 'managed') {
  const provider = pricedModel('private-provider', '0', '0', kind);
  Object.assign(provider.routes[0]?.candidates[0] ?? {}, { providerId: 'private-provider' });
  const disabled = pricedModel('disabled', '0', '0', kind);
  Object.assign(disabled, { enabled: false });
  const output = pricedModel('high-output', '0', '10', kind);
  Object.assign(output.openRouterMetadata?.pricing ?? {}, {
    discount: 1,
    overrides: [{ prompt: '0', completion: '0' }],
  });
  const balanced = pricedModel('balanced', '3', '3', kind);
  Object.assign(balanced.openRouterMetadata?.pricing ?? {}, { request: '1e308' });
  return [
    discoveryModel('basic', { basic: true, kind }),
    pricedModel('precise-high', '1.0000000000000000000000000000002', '0', kind),
    pricedModel('free', '0', '0.000E+000', kind),
    output,
    balanced,
    pricedModel('tie-first', '2E+0000', '4.000', kind),
    pricedModel('high-input', '8', '0', kind),
    pricedModel('tie-second', '0.6e1', '0', kind),
    pricedModel('precise-low', '1.0000000000000000000000000000001', '0', kind),
    pricedModel('private-denied', '0', '0', kind),
    provider,
    disabled,
  ];
}
export const priceOrders: Record<PriceSort, readonly string[]> = {
  'pricing-low-to-high': [
    'free',
    'precise-low',
    'precise-high',
    'balanced',
    'tie-first',
    'tie-second',
    'high-input',
    'high-output',
    'basic',
  ],
  'pricing-high-to-low': [
    'high-output',
    'high-input',
    'balanced',
    'tie-first',
    'tie-second',
    'precise-high',
    'precise-low',
    'free',
    'basic',
  ],
};
export function priceOrderPrivacy(f: ReturnType<typeof discoveryFixture>) {
  discoveryPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /pricing-|precise-|pricing|discount|overrides|1e308|1\.000000/,
  );
}
