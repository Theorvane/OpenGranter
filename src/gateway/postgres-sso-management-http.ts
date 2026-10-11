import { createPostgresGatewayAuditStore } from '../audit/postgres-gateway-audit.ts';
import { createPostgresSsoHumanAuthenticator } from '../identity/postgres-sso-human-authentication.ts';
import {
  createRfc9068SsoAccessTokenVerifier,
  InvalidSsoAccessTokenConfiguration,
  type SsoAccessTokenConfiguration,
} from '../identity/rfc9068-sso-access-tokens.ts';
import type { CredentialSqlClient } from './postgres-proxy-credentials.ts';
import { createPostgresTokenManagementService } from './postgres-token-management-service.ts';
import {
  createSsoManagementHandler,
  createSsoManagementServer,
  type SsoManagementHttpPorts,
} from './sso-management-http.ts';

type Configuration = SsoAccessTokenConfiguration & {
  readonly client: CredentialSqlClient;
  readonly newRequestId: () => string;
};
function compose(ports: Configuration): SsoManagementHttpPorts {
  try {
    if (
      typeof ports !== 'object' ||
      ports === null ||
      Array.isArray(ports) ||
      ['client', 'newRequestId', 'now', 'issuer', 'audience', 'jwks'].some(
        (field) => !Object.hasOwn(ports, field),
      )
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const { client, newRequestId, now, issuer, audience, jwks } = ports;
    if (
      typeof newRequestId !== 'function' ||
      typeof client !== 'object' ||
      client === null ||
      typeof client.query !== 'function'
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const verifyAccessToken = createRfc9068SsoAccessTokenVerifier({ now, issuer, audience, jwks });
    const authenticate = createPostgresSsoHumanAuthenticator({ client, verifyAccessToken });
    const management = createPostgresTokenManagementService({ client, now });
    const audit = createPostgresGatewayAuditStore(client, now);
    return {
      newRequestId,
      authenticate,
      issue: management.issue,
      revoke: management.revoke,
      writeAudit: audit.append,
    };
  } catch {
    throw new InvalidSsoAccessTokenConfiguration();
  }
}
export function createPostgresRfc9068SsoManagementHandler(ports: Configuration) {
  return createSsoManagementHandler(compose(ports));
}
export function createPostgresRfc9068SsoManagementServer(ports: Configuration) {
  return createSsoManagementServer(compose(ports));
}
