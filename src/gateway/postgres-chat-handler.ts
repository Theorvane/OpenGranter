import { createPostgresAuditHistoryReader } from '../audit/postgres-audit-history.ts';
import {
  createPostgresGatewayAuditStore,
  type GatewayAuditSqlClient,
} from '../audit/postgres-gateway-audit.ts';
import { createPostgresIdentitySnapshotStore } from '../identity/postgres-snapshots.ts';
import { createPostgresUsageLedger } from '../usage/postgres-ledger.ts';
import { createPostgresUsageReader } from '../usage/postgres-reader.ts';
import { createAttachmentAuthenticator } from './attachment-authenticator.ts';
import { type ChatHandlerPorts, createChatHandler } from './chat-handler.ts';
import { createPostgresModelCatalogReader } from './postgres-model-catalog.ts';
import { createPostgresProxyCredentialStore } from './postgres-proxy-credentials.ts';
import { createProxyTokenService } from './proxy-tokens.ts';

export interface PostgresChatHandlerPorts<T>
  extends Pick<
    ChatHandlerPorts<T>,
    | 'newRequestId'
    | 'checkLimit'
    | 'resolveSecret'
    | 'invokeDirect'
    | 'invokeDirectTextStream'
    | 'invokeDirectFunctionStream'
    | 'resolveVerifiedProviderSlug'
    | 'invokeOpenRouter'
    | 'invokeOpenRouterTextStream'
    | 'invokeOpenRouterFunctionStream'
    | 'fetchJev'
  > {
  readonly client: GatewayAuditSqlClient;
  readonly now: () => number;
}

/** Compose existing storage adapters; the caller owns connections and trusted upstream ports. */
export function createPostgresChatHandler<T>(
  ports: PostgresChatHandlerPorts<T>,
): (request: Request) => Promise<Response> {
  const { client, ...external } = ports;
  const tokens = createProxyTokenService({
    store: createPostgresProxyCredentialStore(client),
    now: ports.now,
  });
  const identity = createPostgresIdentitySnapshotStore(client);
  const catalog = createPostgresModelCatalogReader(client);
  const audit = createPostgresGatewayAuditStore(client, ports.now);
  return createChatHandler({
    ...external,
    authenticate: createAttachmentAuthenticator({
      verifyCredential: tokens.verifyCredential,
      loadSnapshot: identity.loadSnapshot,
    }),
    resolveRoute: catalog.resolveRoute,
    listPublishedModels: catalog.listPublishedModels,
    writeAudit: audit.append,
    listAudit: createPostgresAuditHistoryReader(client),
    writeUsage: createPostgresUsageLedger(client),
    listUsage: createPostgresUsageReader(client),
  });
}
