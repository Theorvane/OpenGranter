import type { Statement } from '../policy/evaluate.ts';
import { type PolicyVersion, resolvePolicyAttachments } from '../policy/evaluate-attachments.ts';
import {
  createPostgresIdentitySnapshotStore,
  type IdentitySnapshotSqlClient,
} from './postgres-snapshots.ts';
import {
  createPostgresSsoHumanAuthenticator,
  SsoManagementAuthenticationUnavailable,
  SsoManagementUnauthenticated,
} from './postgres-sso-human-authentication.ts';
import {
  createRfc9068SsoAccessTokenVerifier,
  InvalidSsoAccessTokenConfiguration,
  type SsoAccessTokenConfiguration,
  type VerifiedSsoIdentity,
} from './rfc9068-sso-access-tokens.ts';

/** Trusted server-only policy context. Not a proxy credential or permission grant. */
export interface SsoPolicyContext {
  readonly id: string;
  readonly active: true;
  readonly statements: readonly Statement[];
  readonly policyVersions: readonly PolicyVersion[];
}

/** Verify current SSO binding, then read current complete IAM on every call.
 * The caller must authorize each operation and persist SSO-specific audit.
 * Separate binding/snapshot reads are not an atomic revocation guarantee.
 * Never serialize this context as browser session data or invent credentialId.
 */
export function createPostgresSsoPolicyAuthenticator(ports: {
  readonly client: IdentitySnapshotSqlClient;
  readonly verifyAccessToken: (token: string) => Promise<VerifiedSsoIdentity | undefined>;
}): (accessToken: string) => Promise<SsoPolicyContext> {
  const { client, verifyAccessToken } = ports;
  const authenticate = createPostgresSsoHumanAuthenticator({ client, verifyAccessToken });
  const identity = createPostgresIdentitySnapshotStore(client);
  return async (accessToken) => {
    const id = await authenticate(accessToken);
    try {
      const snapshot = await identity.loadSnapshot(id);
      if (!snapshot?.principal.active || snapshot.principal.kind !== 'human')
        throw new SsoManagementUnauthenticated();
      const resolved = resolvePolicyAttachments(snapshot);
      if (!resolved) throw new SsoManagementAuthenticationUnavailable();
      return {
        id,
        active: true,
        statements: resolved.statements,
        policyVersions: resolved.policyVersions,
      };
    } catch (error) {
      if (error instanceof SsoManagementUnauthenticated) throw error;
      throw new SsoManagementAuthenticationUnavailable();
    }
  };
}

/** Local registered-key RFC 9068 verification, never caller-supplied claims. */
export function createPostgresRfc9068SsoPolicyAuthenticator(
  ports: SsoAccessTokenConfiguration & { readonly client: IdentitySnapshotSqlClient },
) {
  try {
    if (
      typeof ports !== 'object' ||
      ports === null ||
      Array.isArray(ports) ||
      ['client', 'now', 'issuer', 'audience', 'jwks'].some((field) => !Object.hasOwn(ports, field))
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const { client, now, issuer, audience, jwks } = ports;
    if (typeof client !== 'object' || client === null || typeof client.query !== 'function')
      throw new InvalidSsoAccessTokenConfiguration();
    const verifyAccessToken = createRfc9068SsoAccessTokenVerifier({ now, issuer, audience, jwks });
    return createPostgresSsoPolicyAuthenticator({ client, verifyAccessToken });
  } catch {
    throw new InvalidSsoAccessTokenConfiguration();
  }
}
