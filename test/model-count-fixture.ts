import { discoveryCatalog, type discoveryFixture } from './model-discovery-filters-fixture.ts';

export function countCatalog(kind: 'managed' | 'delegated' = 'managed') {
  const models = discoveryCatalog();
  for (const model of models)
    for (const route of model.routes) {
      Object.assign(route, { kind });
      for (const candidate of route.candidates) Object.assign(candidate, { kind });
    }
  return models;
}
export function countRequest(f: ReturnType<typeof discoveryFixture>, query = '') {
  const request = f.request(query);
  const url = new URL(request.url);
  url.pathname += '/count';
  return new Request(url, request);
}
