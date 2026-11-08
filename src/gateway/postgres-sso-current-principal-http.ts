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

export interface PostgresSsoCurrentPrincipalHttpPorts extends SsoAccessTokenConfiguration {
  readonly client: SsoIdentityBindingSqlClient;
  readonly newRequestId: () => string;
  /** Required caller-owned durable append, not an optional observer. */
  readonly writeAudit: (event: CurrentPrincipalAuditEvent) => Promise<void>;
}
function compose(ports: PostgresSsoCurrentPrincipalHttpPorts): SsoCurrentPrincipalHttpPorts {
  try {
    if (
      typeof ports !== 'object' ||
      ports === null ||
      Array.isArray(ports) ||
      ['client', 'now', 'issuer', 'audience', 'jwks', 'newRequestId', 'writeAudit'].some(
        (field) => !Object.hasOwn(ports, field),
      )
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const { client, now, issuer, audience, jwks, newRequestId, writeAudit } = ports;
    if (
      typeof client !== 'object' ||
      client === null ||
      typeof client.query !== 'function' ||
      typeof newRequestId !== 'function' ||
      typeof writeAudit !== 'function'
    )
      throw new InvalidSsoAccessTokenConfiguration();
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
/** Caller owns bind/TLS, lifecycle and a genuinely durable audit implementation. */
export function createPostgresRfc9068SsoCurrentPrincipalServer(
  ports: PostgresSsoCurrentPrincipalHttpPorts,
) {
  return createSsoCurrentPrincipalServer(compose(ports));
}
