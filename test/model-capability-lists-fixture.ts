import { discoveryModel } from './model-discovery-filters-fixture.ts';

export function capabilityCatalog(kind: 'managed' | 'delegated' = 'managed') {
  const required = {
    kind,
    inputs: ['text', 'image'],
    parameters: ['tools', 'temperature'],
    name: 'Atlas capabilities',
  };
  return [
    discoveryModel('first', { ...required, created: 20 }),
    discoveryModel('partial-input', { ...required, inputs: ['text'] }),
    discoveryModel('partial-parameter', { ...required, parameters: ['tools'] }),
    discoveryModel('second', {
      ...required,
      inputs: ['image', 'text'],
      parameters: ['temperature', 'tools'],
      outputs: ['image'],
      created: 10,
    }),
    discoveryModel('third', { ...required, outputs: ['audio'], created: 30 }),
    discoveryModel('small', { ...required, context: 1 }),
    discoveryModel('basic', { basic: true, kind }),
    discoveryModel('empty', { kind, inputs: [], parameters: [] }),
    discoveryModel('private-disabled', { ...required, enabled: false }),
    discoveryModel('private-denied', required),
    discoveryModel('private-provider', { ...required, provider: 'private-provider' }),
  ];
}
export const capabilityFields = {
  inputModalities: 'image,text',
  supportedParameters: 'temperature,tools',
  outputModalities: 'image,text',
  context: 8192,
  q: 'ATLAS',
  sort: 'newest',
  limit: 1,
} as const;
export const capabilityQuery =
  '?input_modalities=image%2Ctext&supported_parameters=temperature%2Ctools&output_modalities=image%2Ctext&context=8192&q=ATLAS&sort=newest&limit=1';
