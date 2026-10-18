import { scoredModel } from './model-benchmark-order-fixture.ts';
import { discoveryModel } from './model-discovery-filters-fixture.ts';

export const indices = ['intelligence_index', 'coding_index', 'agentic_index'] as const;
export function rangeCatalog(kind: 'managed' | 'delegated' = 'managed') {
  const deniedProvider = scoredModel('private-provider', [5, 5, 5], [], kind);
  Object.assign(deniedProvider.routes[0]?.candidates[0] ?? {}, { providerId: 'private-provider' });
  const disabled = scoredModel('disabled', [5, 5, 5], [], kind);
  Object.assign(disabled, { enabled: false });
  return [
    scoredModel('unknown', [null, null, null], [], kind),
    scoredModel('low', [1, 7, 9], [], kind),
    scoredModel('middle', [5, 5, 5], [], kind),
    scoredModel('high', [9, 3, 1], [], kind),
    scoredModel('zero', [0, 0, 0], [], kind),
    scoredModel('negative', [-1, -1, -1], [], kind),
    scoredModel('partial', [5, null, 5], [], kind),
    scoredModel('tie', [5, 5, 5], [], kind),
    scoredModel('missing-analysis', undefined, [], kind),
    discoveryModel('basic', { basic: true, kind }),
    scoredModel('private-denied', [5, 5, 5], [], kind),
    deniedProvider,
    disabled,
  ];
}
export const allRanges = {
  min_intelligence_index: '5',
  max_intelligence_index: '5',
  min_coding_index: '5',
  max_coding_index: '5',
  min_agentic_index: '5',
  max_agentic_index: '5',
};
