import {
  type ProxyCredentialStore,
  ProxyCredentialUnavailable,
  type StoredProxyCredential,
} from './proxy-tokens.ts';

export interface CredentialSqlClient {
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function timestamp(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** PostgreSQL credential store with atomic nonsecret lifecycle audit writes. */
export function createPostgresProxyCredentialStore(
  client: CredentialSqlClient,
): ProxyCredentialStore {
  return {
    async insertIssued(input) {
      try {
        const result = await client.query(
          `WITH inserted AS (
             INSERT INTO proxy_credentials
               (credential_id, principal_id, token_digest, created_at_ms, expires_at_ms)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING credential_id, principal_id
           )
           INSERT INTO proxy_credential_events
             (credential_id, principal_id, actor_id, request_id, action, occurred_at_ms)
           SELECT credential_id, principal_id, $6, $7, 'issued', $4 FROM inserted
           RETURNING event_id`,
          [
            input.credentialId,
            input.principalId,
            input.tokenDigest,
            input.createdAt,
            input.expiresAt,
            input.actorId,
            input.requestId,
          ],
        );
        if (result.rows.length !== 1) throw new ProxyCredentialUnavailable();
      } catch {
        throw new ProxyCredentialUnavailable();
      }
    },
    async findById(credentialId): Promise<StoredProxyCredential | undefined> {
      try {
        const result = await client.query(
          `SELECT credential_id, principal_id, token_digest,
                  expires_at_ms::text AS expires_at_ms,
                  revoked_at_ms::text AS revoked_at_ms
           FROM proxy_credentials WHERE credential_id = $1`,
          [credentialId],
        );
        if (result.rows.length === 0) return undefined;
        const row = object(result.rows[0]);
        const expiresAt = timestamp(row?.expires_at_ms);
        const revokedAt = timestamp(row?.revoked_at_ms);
        if (
          result.rows.length !== 1 ||
          typeof row?.credential_id !== 'string' ||
          typeof row.principal_id !== 'string' ||
          typeof row.token_digest !== 'string' ||
          expiresAt === undefined ||
          expiresAt === null ||
          revokedAt === undefined
        ) {
          throw new ProxyCredentialUnavailable();
        }
        return {
          credentialId: row.credential_id,
          principalId: row.principal_id,
          tokenDigest: row.token_digest,
          expiresAt,
          revokedAt,
        };
      } catch {
        throw new ProxyCredentialUnavailable();
      }
    },
    async findOwner(credentialId): Promise<string | undefined> {
      try {
        const result = await client.query(
          'SELECT principal_id FROM proxy_credentials WHERE credential_id = $1',
          [credentialId],
        );
        if (result.rows.length === 0) return undefined;
        const row = object(result.rows[0]);
        if (
          result.rows.length !== 1 ||
          typeof row?.principal_id !== 'string' ||
          row.principal_id.length === 0
        ) {
          throw new ProxyCredentialUnavailable();
        }
        return row.principal_id;
      } catch {
        throw new ProxyCredentialUnavailable();
      }
    },
    async revoke(input) {
      try {
        const result = await client.query(
          `WITH changed AS (
             UPDATE proxy_credentials SET revoked_at_ms = $2
             WHERE credential_id = $1 AND revoked_at_ms IS NULL
             RETURNING credential_id, principal_id
           )
           INSERT INTO proxy_credential_events
             (credential_id, principal_id, actor_id, request_id, action, occurred_at_ms)
           SELECT credential_id, principal_id, $3, $4, 'revoked', $2 FROM changed
           RETURNING event_id`,
          [input.credentialId, input.revokedAt, input.actorId, input.requestId],
        );
        return result.rows.length === 1;
      } catch {
        throw new ProxyCredentialUnavailable();
      }
    },
  };
}
