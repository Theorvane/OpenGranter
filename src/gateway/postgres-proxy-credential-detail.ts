import type { CredentialHistoryEntry } from './postgres-proxy-credential-history.ts';
import type { CredentialSqlClient } from './postgres-proxy-credentials.ts';

export interface CredentialDetailQuery {
  readonly principalId: string;
  readonly credentialId: string;
  readonly observedAt: number;
}
export class InvalidCredentialDetailInput extends Error {
  constructor() {
    super('Invalid credential detail input');
    this.name = 'InvalidCredentialDetailInput';
  }
}
export class CredentialDetailUnavailable extends Error {
  constructor() {
    super('Credential detail unavailable');
    this.name = 'CredentialDetailUnavailable';
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
function capture(input: unknown): CredentialDetailQuery {
  try {
    const value = object(input);
    const principalId = value?.principalId;
    const credentialId = value?.credentialId;
    const observedAt = value?.observedAt;
    if (!text(principalId) || !text(credentialId) || !epoch(observedAt))
      throw new InvalidCredentialDetailInput();
    return { principalId, credentialId, observedAt };
  } catch {
    throw new InvalidCredentialDetailInput();
  }
}

/** Trusted internal detail reader. The caller MUST authorize and durably audit.
 * Observational metadata is not credential verification or historical state.
 */
export function createPostgresProxyCredentialDetail(
  client: CredentialSqlClient,
): (query: CredentialDetailQuery) => Promise<CredentialHistoryEntry | null> {
  return async (query) => {
    const { principalId, credentialId, observedAt } = capture(query);
    try {
      const result = await client.query(
        `SELECT credential_id, principal_id,
                created_at_ms::text AS created_at_ms,
                expires_at_ms::text AS expires_at_ms,
                revoked_at_ms::text AS revoked_at_ms
         FROM proxy_credentials
         WHERE principal_id = $1 AND credential_id = $2
         LIMIT 2`,
        [principalId, credentialId],
      );
      if (!Array.isArray(result.rows) || result.rows.length > 1)
        throw new CredentialDetailUnavailable();
      if (result.rows.length === 0) return null;
      const row = object(result.rows[0]);
      const createdAt = timestamp(row?.created_at_ms);
      const expiresAt = timestamp(row?.expires_at_ms);
      const revokedAt = row?.revoked_at_ms === null ? null : timestamp(row?.revoked_at_ms);
      if (
        row?.principal_id !== principalId ||
        row?.credential_id !== credentialId ||
        createdAt === undefined ||
        expiresAt === undefined ||
        expiresAt <= createdAt ||
        revokedAt === undefined ||
        (revokedAt !== null && revokedAt < createdAt)
      )
        throw new CredentialDetailUnavailable();
      return {
        credentialId,
        principalId,
        createdAt,
        expiresAt,
        revokedAt,
        state: revokedAt !== null ? 'revoked' : expiresAt <= observedAt ? 'expired' : 'active',
      };
    } catch {
      throw new CredentialDetailUnavailable();
    }
  };
}
