import { createPostgresTokenManagementAuditStore } from '../audit/postgres-token-management.ts';
import {
  type CredentialSqlClient,
  createPostgresProxyCredentialStore,
} from './postgres-proxy-credentials.ts';
import { createProxyTokenService, InvalidProxyCredentialInput } from './proxy-tokens.ts';
import { createTokenManagementCoordinator } from './token-management.ts';

/** Internal composition: callers must authenticate actors and resolve their policies. */
export function createPostgresTokenManagementCoordinator(ports: {
  readonly client: CredentialSqlClient;
  readonly now: () => number;
  readonly resolveMaxLifetimeMs?: (principalId: string) => Promise<number>;
}) {
  const store = createPostgresProxyCredentialStore(ports.client);
  const tokens = createProxyTokenService({ store, now: ports.now });
  const audit = createPostgresTokenManagementAuditStore(ports.client, ports.now);
  return createTokenManagementCoordinator({
    findOwner: store.findOwner,
    issueToken: async (input) => {
      if (!ports.resolveMaxLifetimeMs) return tokens.issue(input);
      const maximum = await ports.resolveMaxLifetimeMs(input.principalId);
      const createdAt = ports.now();
      if (
        !Number.isSafeInteger(maximum) ||
        maximum <= 0 ||
        !Number.isSafeInteger(createdAt) ||
        createdAt < 0 ||
        input.expiresAt <= createdAt ||
        input.expiresAt - createdAt > maximum
      )
        throw new InvalidProxyCredentialInput();
      return createProxyTokenService({ store, now: () => createdAt }).issue(input);
    },
    revokeToken: tokens.revoke,
    writeAudit: audit.append,
  });
}
