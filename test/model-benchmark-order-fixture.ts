import assert from 'node:assert/strict';
import { discoveryModel } from './model-discovery-filters-fixture.ts';

export const benchmarkSorts = [
  'intelligence-high-to-low',
  'coding-high-to-low',
  'agentic-high-to-low',
  'design-arena-elo-high-to-low',
] as const;
export type BenchmarkSort = (typeof benchmarkSorts)[number];

export function scoredModel(
  alias: string,
  indices: readonly [number | null, number | null, number | null] | undefined,
  elos: readonly number[] = [],
  kind: 'managed' | 'delegated' = 'managed',
) {
  const model = discoveryModel(alias, { name: `Score ${alias}`, kind });
  assert.ok(model.openRouterMetadata);
  Object.assign(model.openRouterMetadata, {
    benchmarks: {
      ...(indices === undefined
        ? {}
        : {
            artificial_analysis: {
              intelligence_index: indices[0],
              coding_index: indices[1],
              agentic_index: indices[2],
            },
          }),
      design_arena: elos.map((elo) => ({
        arena: 'benchmark-private-arena',
        category: 'benchmark-private-category',
        elo,
        win_rate: -100,
        rank: 99,
      })),
    },
  });
  return model;
}

export function benchmarkOrderCatalog(kind: 'managed' | 'delegated' = 'managed') {
  const deniedProvider = scoredModel('private-provider', [999, 999, 999], [999], kind);
  Object.assign(deniedProvider.routes[0]?.candidates[0] ?? {}, { providerId: 'private-provider' });
  const disabled = scoredModel('disabled', [1000, 1000, 1000], [1000], kind);
  Object.assign(disabled, { enabled: false });
  return [
    scoredModel('unknown', [null, null, null], [], kind),
    scoredModel('tie-first', [3, 3, 3], [1, 7], kind),
    discoveryModel('basic', { basic: true, kind }),
    scoredModel('zero', [0, 0, 0], [0], kind),
    scoredModel('intelligence', [30, -10, -4], [-4, 10], kind),
    scoredModel('coding', [-2, 40, 0], [-2, -1], kind),
    scoredModel('agentic', [0, 0, 50], [2, 3], kind),
    scoredModel('tie-second', [3, 3, 3], [7, -20], kind),
    scoredModel('missing-analysis', undefined, [-4], kind),
    scoredModel('private-denied', [999, 999, 999], [999], kind),
    deniedProvider,
    disabled,
  ];
}

export const benchmarkOrders: Record<BenchmarkSort, readonly string[]> = {
  'intelligence-high-to-low': [
    'intelligence',
    'tie-first',
    'tie-second',
    'zero',
    'agentic',
    'coding',
    'unknown',
    'basic',
    'missing-analysis',
  ],
  'coding-high-to-low': [
    'coding',
    'tie-first',
    'tie-second',
    'zero',
    'agentic',
    'intelligence',
    'unknown',
    'basic',
    'missing-analysis',
  ],
  'agentic-high-to-low': [
    'agentic',
    'tie-first',
    'tie-second',
    'zero',
    'coding',
    'intelligence',
    'unknown',
    'basic',
    'missing-analysis',
  ],
  'design-arena-elo-high-to-low': [
    'intelligence',
    'tie-first',
    'tie-second',
    'agentic',
    'zero',
    'coding',
    'missing-analysis',
    'unknown',
    'basic',
  ],
};
