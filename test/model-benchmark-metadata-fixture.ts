import assert from 'node:assert/strict';
import {
  type discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';
export const benchmarkRow = {
  arena: 'benchmark-private-arena',
  category: 'benchmark-private-category',
  elo: -12.25,
  win_rate: 123.456,
  rank: -1,
};
export const benchmarkData = {
  artificial_analysis: { intelligence_index: 12.5, coding_index: null, agentic_index: -0.25 },
  design_arena: [benchmarkRow, benchmarkRow],
};
export function benchmarkModel(
  extra: Record<string, unknown> = { benchmarks: benchmarkData },
  alias = 'one',
) {
  const model = discoveryModel(alias);
  assert.ok(model.openRouterMetadata);
  Object.assign(model.openRouterMetadata, structuredClone(extra));
  return model;
}
export function benchmarkPrivacy(f: ReturnType<typeof discoveryFixture>) {
  discoveryPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /benchmark-private|benchmarks|artificial_analysis|design_arena|intelligence_index|coding_index|agentic_index|win_rate/u,
  );
}
