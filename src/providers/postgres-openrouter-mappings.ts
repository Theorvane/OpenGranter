import { validOpenRouterSlug } from './openrouter-chat.ts';

export interface OpenRouterMappingSqlClient {
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

export class InvalidOpenRouterMappingLookup extends Error {
  constructor() {
    super('Invalid OpenRouter provider mapping lookup');
    this.name = 'InvalidOpenRouterMappingLookup';
  }
}

export class OpenRouterProviderMappingUnavailable extends Error {
  constructor() {
    super('OpenRouter provider mapping unavailable');
    this.name = 'OpenRouterProviderMappingUnavailable';
  }
}

/** Read administrator-attested configuration; this resolver does not authorize or verify providers. */
export function createPostgresOpenRouterProviderMappingResolver(
  client: OpenRouterMappingSqlClient,
): (providerId: string, upstreamModelId: string) => Promise<string | undefined> {
  return async (providerId, upstreamModelId) => {
    if (
      typeof providerId !== 'string' ||
      providerId.length === 0 ||
      providerId.length > 256 ||
      !validOpenRouterSlug(upstreamModelId)
    ) {
      throw new InvalidOpenRouterMappingLookup();
    }
    try {
      const { rows } = await client.query(
        `SELECT provider_id, upstream_model_id, provider_slug, enabled, verified
         FROM openrouter_provider_mappings
         WHERE provider_id = $1 AND upstream_model_id = $2
           AND enabled = true AND verified = true`,
        [providerId, upstreamModelId],
      );
      if (rows.length === 0) return undefined;
      if (rows.length !== 1) throw new OpenRouterProviderMappingUnavailable();
      const value = rows[0];
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new OpenRouterProviderMappingUnavailable();
      }
      const row = value as Record<string, unknown>;
      if (
        row.provider_id !== providerId ||
        row.upstream_model_id !== upstreamModelId ||
        row.enabled !== true ||
        row.verified !== true ||
        !validOpenRouterSlug(row.provider_slug)
      ) {
        throw new OpenRouterProviderMappingUnavailable();
      }
      return row.provider_slug;
    } catch {
      throw new OpenRouterProviderMappingUnavailable();
    }
  };
}
