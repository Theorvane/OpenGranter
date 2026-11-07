import { createPostgresCurrentPrincipalAuditStore } from '../audit/postgres-current-principal.ts';
import type { GatewayAuditSqlClient } from '../audit/postgres-gateway-audit.ts';
import { createPostgresSsoHumanAuthenticator } from '../identity/postgres-sso-human-authentication.ts';
import type { SsoIdentityBindingSqlClient } from '../identity/postgres-sso-identity-bindings.ts';
import {
  createRfc9068SsoAccessTokenVerifier,
  InvalidSsoAccessTokenConfiguration,
  type SsoAccessTokenConfiguration,
} from '../identity/rfc9068-sso-access-tokens.ts';
import {
  type CurrentPrincipalAuditEvent,
  createSsoCurrentPrincipalHandler,
  createSsoCurrentPrincipalServer,
  type SsoCurrentPrincipalHttpPorts,
} from './sso-current-principal-http.ts';

export type PostgresSsoCurrentPrincipalHttpPorts = SsoAccessTokenConfiguration & {
  readonly client: SsoIdentityBindingSqlClient;
  readonly newRequestId: () => string;
} & (
    | {
        readonly writeAudit: (event: CurrentPrincipalAuditEvent) => Promise<void>;
        readonly auditClient?: never;
      }
    | { readonly auditClient: GatewayAuditSqlClient; readonly writeAudit?: never }
  );
function compose(ports: PostgresSsoCurrentPrincipalHttpPorts): SsoCurrentPrincipalHttpPorts {
  try {
    if (
      typeof ports !== 'object' ||
      ports === null ||
      Array.isArray(ports) ||
      ['client', 'now', 'issuer', 'audience', 'jwks', 'newRequestId'].some(
        (field) => !Object.hasOwn(ports, field),
      ) ||
      Object.hasOwn(ports, 'writeAudit') === Object.hasOwn(ports, 'auditClient')
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const { client, now, issuer, audience, jwks, newRequestId } = ports;
    if (
      typeof client !== 'object' ||
      client === null ||
      typeof client.query !== 'function' ||
      typeof newRequestId !== 'function'
    )
      throw new InvalidSsoAccessTokenConfiguration();
    let writeAudit: (event: CurrentPrincipalAuditEvent) => Promise<void>;
    if (Object.hasOwn(ports, 'auditClient')) {
      const auditClient = ports.auditClient;
      if (!auditClient) throw new InvalidSsoAccessTokenConfiguration();
      writeAudit = createPostgresCurrentPrincipalAuditStore(auditClient, now).append;
    } else {
      const callback = ports.writeAudit;
      if (typeof callback !== 'function') throw new InvalidSsoAccessTokenConfiguration();
      writeAudit = callback;
    }
    const verifyAccessToken = createRfc9068SsoAccessTokenVerifier({ now, issuer, audience, jwks });
    const authenticate = createPostgresSsoHumanAuthenticator({ client, verifyAccessToken });
    return { authenticate, newRequestId, writeAudit };
  } catch {
    throw new InvalidSsoAccessTokenConfiguration();
  }
}
/** Fresh current identity only. No callback authentication override or automatic mount. */
export function createPostgresRfc9068SsoCurrentPrincipalHandler(
  ports: PostgresSsoCurrentPrincipalHttpPorts,
) {
  return createSsoCurrentPrincipalHandler(compose(ports));
}
/** Caller owns bind/TLS, lifecycle and committed/autocommit audit-client semantics. */
export function createPostgresRfc9068SsoCurrentPrincipalServer(
  ports: PostgresSsoCurrentPrincipalHttpPorts,
) {
  return createSsoCurrentPrincipalServer(compose(ports));
}
