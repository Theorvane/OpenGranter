import { discoveryModel } from './model-discovery-filters-fixture.ts';

export function singleModelCatalog(kind: 'managed' | 'delegated' = 'managed') {
  const models = [
    discoveryModel('fixture/chat', { kind }),
    discoveryModel('fixture/chat:free', { kind }),
    discoveryModel('fixture/模型', { kind }),
    discoveryModel('fixture/basic', { kind, basic: true }),
    discoveryModel('fixture/private-provider', { kind, provider: 'private-provider' }),
    discoveryModel('fixture/disabled', { kind, enabled: false }),
  ];
  for (const model of models)
    if (model.openRouterMetadata)
      Object.assign(model.openRouterMetadata, {
        links: { details: '/api/v1/models/fixture/chat/endpoints' },
        alias_target: { slug: 'fixture/unpublished-target', name: 'private target' },
      });
  return models;
}
export function singleModelRequest(alias = 'fixture/chat', query = '') {
  return new Request(`http://untrusted.example/api/v1/model/${alias}${query}`, {
    headers: { authorization: 'Bearer fixture' },
  });
}
