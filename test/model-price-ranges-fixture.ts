import assert from 'node:assert/strict';
import {
  type discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';
import { pricedModel } from './model-price-order-fixture.ts';

export const priceBounds = {
  min_price: '2',
  max_price: '4',
  min_output_price: '3',
  max_output_price: '5',
};
export const priceBoundNames = Object.keys(priceBounds);
export function priceRangeCatalog(kind: 'managed' | 'delegated' = 'managed') {
  const deniedProvider = pricedModel('private-provider', '3e-6', '4e-6', kind);
  Object.assign(deniedProvider.routes[0]?.candidates[0] ?? {}, { providerId: 'private-provider' });
  const disabled = pricedModel('disabled', '3e-6', '4e-6', kind);
  Object.assign(disabled, { enabled: false });
  const tie = pricedModel('tie', '0.0000030', '0.0000040', kind);
  Object.assign(tie.openRouterMetadata?.pricing ?? {}, {
    discount: 1,
    overrides: [{ prompt: '0', completion: '0' }],
    request: '1e308',
  });
  return [
    pricedModel('free', '0', '0', kind),
    pricedModel('low', '1e-6', '2e-6', kind),
    pricedModel('middle', '3e-6', '4e-6', kind),
    tie,
    pricedModel('high', '5e-6', '6e-6', kind),
    discoveryModel('basic', { basic: true, kind }),
    pricedModel('private-denied', '3e-6', '4e-6', kind),
    deniedProvider,
    disabled,
  ];
}
export function priceRangePrivacy(f: ReturnType<typeof discoveryFixture>) {
  discoveryPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /min_price|max_price|min_output_price|max_output_price|priceRanges|pricing|discount|overrides|3e-6|4e-6/u,
  );
}
