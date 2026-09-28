import { createPostgresTokenManagementAuditStore } from '../audit/postgres-token-management.ts';
import {
  type CredentialSqlClient,
  createPostgresProxyCredentialStore,
} from './postgres-proxy-credentials.ts';
import { createProxyTokenService } from './proxy-tokens.ts';
import { createTokenManagementCoordinator } from './token-management.ts';

/** Internal composition: callers must authenticate actors and resolve their policies. */
export function createPostgresTokenManagementCoordinator(ports: {
  readonly client: CredentialSqlClient;
  readonly now: () => number;
}) {
  const store = createPostgresProxyCredentialStore(ports.client);
  const tokens = createProxyTokenService({ store, now: ports.now });
  const audit = createPostgresTokenManagementAuditStore(ports.client, ports.now);
  return createTokenManagementCoordinator({
    findOwner: store.findOwner,
    issueToken: tokens.issue,
    revokeToken: tokens.revoke,
    writeAudit: audit.append,
  });
}
