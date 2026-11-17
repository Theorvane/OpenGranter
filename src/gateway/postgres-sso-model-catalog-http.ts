import type { Server } from 'node:http';
import { createPostgresSsoCatalogAuditStore } from '../audit/postgres-sso-catalog.ts';
import type { SsoAccessTokenConfiguration } from '../identity/rfc9068-sso-access-tokens.ts';
import type { ModelCatalogSqlClient } from './postgres-model-catalog.ts';
import { createPostgresSsoModelCatalog } from './postgres-sso-model-catalog.ts';
import {
  createSsoModelCatalogHandler,
  createSsoModelCatalogServer,
  type SsoModelCatalogHttpPorts,
} from './sso-model-catalog-http.ts';

export interface PostgresSsoModelCatalogHttpPorts extends SsoAccessTokenConfiguration {
  readonly client: ModelCatalogSqlClient;
  readonly newRequestId: () => string;
}

function compose(ports: PostgresSsoModelCatalogHttpPorts): SsoModelCatalogHttpPorts {
  const { client, now, issuer, audience, jwks, newRequestId } = ports;
  const audit = createPostgresSsoCatalogAuditStore(client, now);
  const catalog = createPostgresSsoModelCatalog({
    client,
    now,
    issuer,
    audience,
    jwks,
    writeAudit: audit.append,
  });
  return { catalog, newRequestId };
}

/** Explicit registered-key SSO catalog with awaited durable PostgreSQL audit.
 * No callback override, cookie authentication, ingress or runtime activation.
 * The caller owns migrations, database lifecycle and trusted configuration.
 */
export function createPostgresSsoModelCatalogHandler(
  ports: PostgresSsoModelCatalogHttpPorts,
): (request: Request) => Promise<Response> {
  return createSsoModelCatalogHandler(compose(ports));
}

/** Returns an unbound server; listening and TLS remain caller-owned. */
export function createPostgresSsoModelCatalogServer(
  ports: PostgresSsoModelCatalogHttpPorts,
): Server {
  return createSsoModelCatalogServer(compose(ports));
}
