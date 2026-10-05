import assert from 'node:assert/strict';
import { createChatHandler, type PublishedModel } from '../src/gateway/chat-handler.ts';
import type { Statement } from '../src/policy/evaluate.ts';

export function discoveryModel(
  alias: string,
  options: {
    context?: number | null;
    outputs?: string[];
    inputs?: string[];
    name?: string;
    slug?: string;
    created?: number;
    parameters?: string[];
    basic?: boolean;
    enabled?: boolean;
    provider?: string;
    kind?: 'managed' | 'delegated';
  } = {},
): PublishedModel {
  const kind = options.kind ?? 'managed';
  return {
    alias,
    created: options.created ?? 42,
    enabled: options.enabled ?? true,
    routes: [
      {
        kind,
        candidates: [
          {
            id: 'candidate',
            kind,
            providerId: options.provider ?? 'provider',
            upstreamModelId: 'upstream',
          },
        ],
      },
    ],
    ...(options.basic
      ? {}
      : {
          openRouterMetadata: {
            canonical_slug: options.slug ?? 'private/canonical',
            name: options.name ?? 'private published name',
            context_length: options.context === undefined ? 8192 : options.context,
            architecture: {
              modality: 'unrelated-private-label',
              input_modalities: options.inputs ?? ['text'],
              output_modalities: options.outputs ?? ['text'],
            },
            pricing: { prompt: '0.000001', completion: '0.000002' },
            top_provider: { is_moderated: true, context_length: 999999 },
            supported_parameters: options.parameters ?? ['tools'],
            supported_voices: null,
            default_parameters: null,
            per_request_limits: null,
            links: { details: 'https://catalog.example/private-model' },
          },
        }),
  };
}
export const discoveryAllow: Statement = { effect: 'Allow', actions: ['*'], resources: ['*'] };
export function discoveryCatalog(): PublishedModel[] {
  return [
    discoveryModel('small', { context: 1024, parameters: ['temperature'] }),
    discoveryModel('multi', { outputs: ['text', 'image'], parameters: ['tools', 'temperature'] }),
    discoveryModel('unknown', { context: null }),
    discoveryModel('large', { context: 16384, outputs: ['text', 'image'] }),
    discoveryModel('image', { outputs: ['image'] }),
    discoveryModel('basic', { basic: true }),
    discoveryModel('private-denied'),
    discoveryModel('private-provider', { provider: 'private-provider' }),
    discoveryModel('private-disabled', { enabled: false }),
  ];
}
export function discoveryFixture(
  models = discoveryCatalog(),
  options: {
    statements?: Statement[];
    authenticated?: boolean;
    catalogFailure?: boolean;
    auditFailure?: boolean;
    audit?: () => void;
  } = {},
) {
  let reads = 0;
  const events: unknown[] = [];
  const statements = options.statements ?? [
    discoveryAllow,
    {
      effect: 'Deny' as const,
      actions: ['*'],
      resources: ['model:private-denied', 'provider:private-provider'],
    },
  ];
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () =>
      options.authenticated === false
        ? undefined
        : { id: 'user', active: true, credentialId: 'credential', policyVersions: [], statements },
    listPublishedModels: async () => {
      reads++;
      if (options.catalogFailure) throw Error('private catalog failure');
      return models;
    },
    resolveRoute: async () => assert.fail('listing routed'),
    resolveSecret: async () => assert.fail('listing read secrets'),
    checkLimit: async () => assert.fail('listing checked limits'),
    invokeDirect: async () => assert.fail('listing invoked'),
    invokeOpenRouter: async () => assert.fail('listing invoked'),
    writeUsage: async () => assert.fail('listing wrote usage'),
    writeAudit: async (e) => {
      if (options.auditFailure) throw Error('private audit failure');
      options.audit?.();
      events.push(e);
    },
  });
  const request = (query = '', base = '/api/v1') =>
    new Request(`http://untrusted.example${base}/models${query}`, {
      headers: { authorization: 'Bearer fixture' },
    });
  return { models, statements, handler, request, events, reads: () => reads };
}
export function discoveryPrivacy(f: ReturnType<typeof discoveryFixture>) {
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /private-|private\/|catalog\.example|supported_parameters|input_modalities|output_modalities|context_length|0\.000001|Atlas|ATLAS|"q"|"sort"|searchText|sortOrder/u,
  );
}
