import type { CredentialSqlClient } from './postgres-proxy-credentials.ts';

export interface CredentialHistoryCursor {
  readonly createdAt: number;
  readonly credentialId: string;
}
export interface CredentialHistoryQuery {
  readonly principalId: string;
  readonly limit: number;
  readonly observedAt: number;
  readonly cursor: CredentialHistoryCursor | null;
}
export interface CredentialHistoryEntry extends CredentialHistoryCursor {
  readonly principalId: string;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  readonly state: 'active' | 'expired' | 'revoked';
}
export interface CredentialHistoryPage {
  readonly credentials: readonly CredentialHistoryEntry[];
  readonly hasMore: boolean;
  readonly nextCursor: CredentialHistoryCursor | null;
}
export class InvalidCredentialHistoryInput extends Error {
  constructor() {
    super('Invalid credential history input');
    this.name = 'InvalidCredentialHistoryInput';
  }
}
export class CredentialHistoryUnavailable extends Error {
  constructor() {
    super('Credential history unavailable');
    this.name = 'CredentialHistoryUnavailable';
  }
}
function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function text(value: unknown): value is string {
  if (typeof value !== 'string' || !value.length || value.length > 256) return false;
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  return true;
}
function epoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return;
  const parsed = Number(value);
  return epoch(parsed) ? parsed : undefined;
}
function cursor(value: unknown): value is CredentialHistoryCursor {
  const record = object(value);
  return !!record && epoch(record.createdAt) && text(record.credentialId);
}
/** PostgreSQL UTF8 COLLATE C compares encoded bytes, not JS UTF16 code units. */
function before(entry: CredentialHistoryCursor, previous: CredentialHistoryCursor): boolean {
  return (
    entry.createdAt < previous.createdAt ||
    (entry.createdAt === previous.createdAt &&
      Buffer.compare(Buffer.from(entry.credentialId), Buffer.from(previous.credentialId)) < 0)
  );
}

/** Trusted internal metadata reader. Caller MUST authorize and durably audit.
 * No public route or credential verification: lifecycle state is observational.
 */
export function createPostgresProxyCredentialHistory(
  client: CredentialSqlClient,
): (query: CredentialHistoryQuery) => Promise<CredentialHistoryPage> {
  return async (query) => {
    if (
      !query ||
      !text(query.principalId) ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      !epoch(query.observedAt) ||
      (query.cursor !== null && !cursor(query.cursor))
    )
      throw new InvalidCredentialHistoryInput();
    // Capture the query before awaiting a driver controlled by the host.
    const { principalId, limit, observedAt } = query;
    const continuation =
      query.cursor === null
        ? null
        : {
            createdAt: query.cursor.createdAt,
            credentialId: query.cursor.credentialId,
          };
    try {
      const result = await client.query(
        `SELECT credential_id, principal_id,
                created_at_ms::text AS created_at_ms,
                expires_at_ms::text AS expires_at_ms,
                revoked_at_ms::text AS revoked_at_ms
         FROM proxy_credentials
         WHERE principal_id = $1
           AND ($2::bigint IS NULL OR (created_at_ms, credential_id COLLATE "C") < ($2::bigint, $3::text COLLATE "C"))
         ORDER BY proxy_credentials.created_at_ms DESC, credential_id COLLATE "C" DESC
         LIMIT $4`,
        [
          principalId,
          continuation?.createdAt ?? null,
          continuation?.credentialId ?? null,
          limit + 1,
        ],
      );
      if (!Array.isArray(result.rows) || result.rows.length > limit + 1)
        throw new CredentialHistoryUnavailable();
      let previous = continuation;
      const entries: CredentialHistoryEntry[] = result.rows.map((value) => {
        const row = object(value);
        const createdAt = timestamp(row?.created_at_ms);
        const expiresAt = timestamp(row?.expires_at_ms);
        const revokedAt = row?.revoked_at_ms === null ? null : timestamp(row?.revoked_at_ms);
        if (
          !text(row?.credential_id) ||
          row?.principal_id !== principalId ||
          createdAt === undefined ||
          expiresAt === undefined ||
          expiresAt <= createdAt ||
          revokedAt === undefined ||
          (revokedAt !== null && revokedAt < createdAt)
        )
          throw new CredentialHistoryUnavailable();
        const entry: CredentialHistoryEntry = {
          credentialId: row.credential_id,
          principalId,
          createdAt,
          expiresAt,
          revokedAt,
          state: revokedAt !== null ? 'revoked' : expiresAt <= observedAt ? 'expired' : 'active',
        };
        if (previous !== null && !before(entry, previous)) throw new CredentialHistoryUnavailable();
        previous = entry;
        return entry;
      });
      const credentials = entries.slice(0, limit);
      const hasMore = entries.length > limit;
      const last = credentials.at(-1);
      return {
        credentials,
        hasMore,
        nextCursor:
          hasMore && last
            ? {
                createdAt: last.createdAt,
                credentialId: last.credentialId,
              }
            : null,
      };
    } catch {
      throw new CredentialHistoryUnavailable();
    }
  };
}
