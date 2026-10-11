import assert from 'node:assert/strict';
import {
  type discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';
export const overridePrices = [
  'prompt',
  'completion',
  'audio',
  'input_audio_cache',
  'input_cache_read',
  'input_cache_write',
  'input_cache_write_1h',
] as const;
export const overrideNumbers = ['min_prompt_tokens', 'utc_start', 'utc_end'] as const;
export const basePrices = { prompt: '1e-6', completion: '0.0000020' };
export const allPrices = {
  ...basePrices,
  request: '0',
  image: '1.00',
  image_output: '2e-4',
  image_token: '3e-5',
  audio: '4e-6',
  audio_output: '5e-7',
  input_audio_cache: '6e-8',
  input_cache_read: '7e-9',
  input_cache_write: '8e+1',
  input_cache_write_1h: '9.00',
  internal_reasoning: '10',
  web_search: '11',
};
export const overrideData = {
  prompt: '3e-7',
  completion: '0.0000040',
  audio: '0',
  input_audio_cache: '2E-8',
  input_cache_read: '5e-9',
  input_cache_write: '6e+1',
  input_cache_write_1h: '7.00',
  min_prompt_tokens: -0.5,
  utc_start: 25.125,
  utc_end: -1.25,
  utc_days: ['monday', 'pricing-private-future', 'monday'],
};
export const pricingData = {
  ...basePrices,
  discount: -0.5,
  overrides: [overrideData, overrideData],
};
export function pricingModel(pricing: unknown = pricingData, alias = 'one') {
  const model = discoveryModel(alias);
  assert.ok(model.openRouterMetadata);
  Object.assign(model.openRouterMetadata, { pricing: structuredClone(pricing) });
  return model;
}
export function pricingPrivacy(f: ReturnType<typeof discoveryFixture>) {
  discoveryPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /pricing-private|pricing|discount|overrides|utc_days|utc_start|utc_end|min_prompt_tokens/u,
  );
}
