import { discoveryModel } from './model-discovery-filters-fixture.ts';

export function explorationCatalog(kind: 'managed' | 'delegated' = 'managed') {
  return [
    discoveryModel('unknown', {
      kind,
      context: null,
      created: 10,
      name: 'Delta Unknown',
      slug: 'alpha/unknown',
    }),
    discoveryModel('tie-first', {
      kind,
      context: 8192,
      created: 20,
      inputs: ['text', 'image'],
      name: 'Atlas Vision',
      slug: 'lab/atlas-first',
    }),
    discoveryModel('basic', { kind, basic: true, created: 40 }),
    discoveryModel('zero', {
      kind,
      context: 0,
      created: 30,
      inputs: [],
      name: 'Zero',
      slug: 'alpha/zero',
    }),
    discoveryModel('big', {
      kind,
      context: 16384,
      created: 50,
      inputs: ['audio', 'file'],
      name: 'Atlas Audio',
      slug: 'lab/atlas-big',
    }),
    discoveryModel('tie-second', {
      kind,
      context: 8192,
      created: 20,
      inputs: ['text', 'image', 'file'],
      name: 'Atlas File',
      slug: 'lab/atlas-second',
    }),
    discoveryModel('private-denied', {
      kind,
      context: 999999,
      created: 99,
      inputs: ['text', 'image'],
      name: 'Atlas Hidden',
    }),
    discoveryModel('private-provider', {
      kind,
      provider: 'private-provider',
      context: 999999,
      created: 99,
      inputs: ['text', 'image'],
      name: 'Atlas Hidden',
    }),
    discoveryModel('private-disabled', {
      kind,
      enabled: false,
      context: 999999,
      created: 99,
      inputs: ['text', 'image'],
      name: 'Atlas Hidden',
    }),
  ];
}
export const explorationCombined =
  '?input_modalities=image&output_modalities=text&supported_parameters=tools&context=8192&q=ATLAS&sort=newest&limit=1';
