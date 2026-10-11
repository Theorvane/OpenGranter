import {
  createPostgresSsoIdentityBindingReader,
  type SsoIdentityBindingSqlClient,
} from './postgres-sso-identity-bindings.ts';
import type { VerifiedSsoIdentity } from './rfc9068-sso-access-tokens.ts';

export class SsoManagementUnauthenticated extends Error {
  constructor() {
    super('SSO management unauthenticated');
    this.name = 'SsoManagementUnauthenticated';
  }
}

export class SsoManagementAuthenticationUnavailable extends Error {
  constructor() {
    super('SSO management authentication unavailable');
    this.name = 'SsoManagementAuthenticationUnavailable';
  }
}

function validAccessToken(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 16384 ||
    value.includes('\0')
  )
    return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

/** Trusted verifier plus a current exact active-human binding; supplies identity, not IAM rights. */
export function createPostgresSsoHumanAuthenticator(ports: {
  readonly client: SsoIdentityBindingSqlClient;
  readonly verifyAccessToken: (token: string) => Promise<VerifiedSsoIdentity | undefined>;
}): (accessToken: string) => Promise<string> {
  const { client, verifyAccessToken } = ports;
  const bindings = createPostgresSsoIdentityBindingReader(client);
  return async (accessToken) => {
    if (!validAccessToken(accessToken)) throw new SsoManagementUnauthenticated();
    let verified: VerifiedSsoIdentity | undefined;
    try {
      verified = await verifyAccessToken(accessToken);
    } catch {
      throw new SsoManagementAuthenticationUnavailable();
    }
    if (verified === undefined) throw new SsoManagementUnauthenticated();
    let principalId: string | undefined;
    try {
      principalId = await bindings.resolveHumanPrincipal(verified);
    } catch {
      throw new SsoManagementAuthenticationUnavailable();
    }
    if (principalId === undefined) throw new SsoManagementUnauthenticated();
    return principalId;
  };
}
