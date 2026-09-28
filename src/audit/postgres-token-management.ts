import type { CredentialSqlClient } from '../gateway/postgres-proxy-credentials.ts';
import type { TokenManagementAuditEvent } from '../gateway/token-management.ts';

export class InvalidTokenManagementAuditEvent extends Error {
  constructor() {
    super('Invalid token management audit event');
    this.name = 'InvalidTokenManagementAuditEvent';
  }
}

export class TokenManagementAuditUnavailable extends Error {
  constructor() {
    super('Token management audit store unavailable');
    this.name = 'TokenManagementAuditUnavailable';
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidTokenManagementAuditEvent();
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    throw new InvalidTokenManagementAuditEvent();
  }
  return value;
}

function project(value: unknown, occurredAt: number) {
  const event = record(value);
  if (
    !Number.isSafeInteger(occurredAt) ||
    occurredAt < 0 ||
    (event.operation !== 'issue' && event.operation !== 'revoke') ||
    (event.kind !== 'token-management-allowed' && event.kind !== 'token-management-denied') ||
    !Array.isArray(event.policyVersions)
  )
    throw new InvalidTokenManagementAuditEvent();
  const target = event.targetPrincipalId === null ? null : identifier(event.targetPrincipalId);
  const credential = event.operation === 'revoke' ? identifier(event.credentialId) : null;
  if (
    (event.kind === 'token-management-allowed' && target === null) ||
    (event.operation === 'issue' && event.credentialId !== undefined)
  ) {
    throw new InvalidTokenManagementAuditEvent();
  }
  return {
    occurredAt,
    operation: event.operation,
    outcome: event.kind === 'token-management-allowed' ? 'allowed' : 'denied',
    requestId: identifier(event.requestId),
    actorId: identifier(event.actorId),
    targetPrincipalId: target,
    credentialId: credential,
    policyVersions: event.policyVersions.map((value: unknown) => {
      const policy = record(value);
      return { id: identifier(policy.id), version: identifier(policy.version) };
    }),
  };
}

/** Required metadata append before mutation; an allowed decision is not a completion event. */
export function createPostgresTokenManagementAuditStore(
  client: CredentialSqlClient,
  now: () => number,
): { readonly append: (event: TokenManagementAuditEvent) => Promise<void> } {
  return {
    async append(event) {
      let occurredAt: number;
      try {
        occurredAt = now();
      } catch {
        throw new TokenManagementAuditUnavailable();
      }
      const projected = project(event, occurredAt);
      try {
        const result = await client.query(
          `INSERT INTO token_management_decisions
             (occurred_at_ms, operation, outcome, request_id, actor_id,
              target_principal_id, credential_id, policy_versions)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           RETURNING event_id::text AS event_id`,
          [
            projected.occurredAt,
            projected.operation,
            projected.outcome,
            projected.requestId,
            projected.actorId,
            projected.targetPrincipalId,
            projected.credentialId,
            JSON.stringify(projected.policyVersions),
          ],
        );
        const row = result.rows[0];
        if (
          result.rows.length !== 1 ||
          typeof row !== 'object' ||
          row === null ||
          !('event_id' in row) ||
          typeof row.event_id !== 'string' ||
          !/^[1-9][0-9]*$/u.test(row.event_id)
        )
          throw new TokenManagementAuditUnavailable();
      } catch {
        throw new TokenManagementAuditUnavailable();
      }
    },
  };
}
