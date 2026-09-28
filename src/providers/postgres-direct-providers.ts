import {
  type DirectProviderRegistration,
  snapshotDirectProviderRegistrations,
} from './direct-chat.ts';

export interface DirectProviderSqlClient {
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

export class DirectProviderStoreUnavailable extends Error {
  constructor() {
    super('Direct provider registration store unavailable');
    this.name = 'DirectProviderStoreUnavailable';
  }
}

/** Load a trusted configuration snapshot, not a caller's permissions or provider keys. */
export function createPostgresDirectProviderRegistrationReader(
  client: DirectProviderSqlClient,
): () => Promise<DirectProviderRegistration[]> {
  return async () => {
    try {
      const result = await client.query(
        `SELECT provider_id, kind, credential_ref, enabled,
                max_output_tokens::double precision AS max_output_tokens
         FROM direct_provider_registrations WHERE enabled = true ORDER BY provider_id`,
        [],
      );
      const mapped = result.rows.map((value: unknown) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new DirectProviderStoreUnavailable();
        }
        const row = value as Record<string, unknown>;
        if (row.enabled !== true || row.max_output_tokens === undefined) {
          throw new DirectProviderStoreUnavailable();
        }
        return {
          providerId: row.provider_id,
          kind: row.kind,
          credentialRef: row.credential_ref,
          ...(row.max_output_tokens === null ? {} : { maxOutputTokens: row.max_output_tokens }),
        };
      });
      // The same boundary validator supplies defensive copies for both adapters.
      return snapshotDirectProviderRegistrations(mapped);
    } catch {
      throw new DirectProviderStoreUnavailable();
    }
  };
}
