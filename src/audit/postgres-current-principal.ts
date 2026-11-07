import type { CurrentPrincipalAuditEvent } from '../gateway/sso-current-principal-http.ts';
import type { GatewayAuditSqlClient } from './postgres-gateway-audit.ts';

export class InvalidCurrentPrincipalAuditEvent extends Error {
  constructor() {
    super('Invalid current principal audit event');
    this.name = 'InvalidCurrentPrincipalAuditEvent';
  }
}
export class CurrentPrincipalAuditUnavailable extends Error {
  constructor() {
    super('Current principal audit store unavailable');
    this.name = 'CurrentPrincipalAuditUnavailable';
  }
}
function principalIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code < 32 ||
        (code >= 127 && code <= 159) ||
        (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
      );
    })
  );
}
function project(value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    ['requestId', 'outcome', 'principalId'].some((field) => !Object.hasOwn(value, field))
  )
    throw new InvalidCurrentPrincipalAuditEvent();
  const { requestId, outcome, principalId } = value as Record<string, unknown>;
  if (
    typeof requestId !== 'string' ||
    requestId.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(requestId) ||
    (outcome !== 'ready' && outcome !== 'unauthenticated' && outcome !== 'unavailable') ||
    (outcome === 'ready' ? !principalIdentifier(principalId) : principalId !== null)
  )
    throw new InvalidCurrentPrincipalAuditEvent();
  return { requestId, outcome, principalId };
}
/** Uses only an explicitly installed dedicated table; never runs DDL or commits caller transactions. */
export function createPostgresCurrentPrincipalAuditStore(
  client: GatewayAuditSqlClient,
  now: () => number,
): {
  readonly append: (event: CurrentPrincipalAuditEvent) => Promise<void>;
} {
  if (
    typeof client !== 'object' ||
    client === null ||
    typeof client.query !== 'function' ||
    typeof now !== 'function'
  )
    throw new TypeError('Invalid current principal audit configuration');
  const query = client.query.bind(client);
  return {
    async append(event) {
      let projected: ReturnType<typeof project>;
      try {
        projected = project(event);
      } catch {
        throw new InvalidCurrentPrincipalAuditEvent();
      }
      try {
        const occurredAt = now();
        if (!Number.isSafeInteger(occurredAt) || occurredAt < 0)
          throw new CurrentPrincipalAuditUnavailable();
        const result = await query(
          `INSERT INTO sso_current_principal_audit_events
           (occurred_at_ms, request_id, outcome, principal_id)
           VALUES ($1, $2, $3, $4) RETURNING event_id::text AS event_id`,
          [occurredAt, projected.requestId, projected.outcome, projected.principalId],
        );
        const row = result.rows[0];
        if (
          result.rows.length !== 1 ||
          typeof row !== 'object' ||
          row === null ||
          !('event_id' in row) ||
          typeof row.event_id !== 'string' ||
          row.event_id.length > 19 ||
          !/^[1-9][0-9]*$/u.test(row.event_id) ||
          BigInt(row.event_id) > 9_223_372_036_854_775_807n
        )
          throw new CurrentPrincipalAuditUnavailable();
      } catch {
        throw new CurrentPrincipalAuditUnavailable();
      }
    },
  };
}
