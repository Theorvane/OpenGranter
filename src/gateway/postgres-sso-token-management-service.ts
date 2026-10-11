import { createPostgresSsoIdentityBindingReader } from '../identity/postgres-sso-identity-bindings.ts';
import {
  createRfc9068SsoAccessTokenVerifier,
  InvalidSsoAccessTokenConfiguration,
  type SsoAccessTokenConfiguration,
  type VerifiedSsoIdentity,
} from '../identity/rfc9068-sso-access-tokens.ts';
import type { CredentialSqlClient } from './postgres-proxy-credentials.ts';
import { createPostgresTokenManagementService } from './postgres-token-management-service.ts';

interface SsoRequest {
  readonly accessToken: string;
  readonly requestId: string;
}
interface SsoIssueRequest extends SsoRequest {
  readonly principalId: string;
  readonly expiresAt: number;
}
interface SsoRevokeRequest extends SsoRequest {
  readonly credentialId: string;
}
export class InvalidSsoTokenManagementInput extends Error {
  constructor() {
    super('Invalid SSO token management input');
    this.name = 'InvalidSsoTokenManagementInput';
  }
}
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
function request(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    fields.some((field) => !Object.hasOwn(input, field))
  )
    throw new InvalidSsoTokenManagementInput();
  return input as Record<string, unknown>;
}
function opaque(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.includes('\0'))
    return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

export function createPostgresSsoTokenManagementService(ports: {
  readonly client: CredentialSqlClient;
  readonly now: () => number;
  readonly verifyAccessToken: (token: string) => Promise<VerifiedSsoIdentity | undefined>;
}): {
  readonly issue: (
    input: SsoIssueRequest,
  ) => Promise<{ readonly credentialId: string; readonly token: string }>;
  readonly revoke: (input: SsoRevokeRequest) => Promise<boolean>;
} {
  const { client, now, verifyAccessToken } = ports;
  const bindings = createPostgresSsoIdentityBindingReader(client);
  const management = createPostgresTokenManagementService({ client, now });
  async function authenticate(token: string): Promise<string> {
    let verified: VerifiedSsoIdentity | undefined;
    try {
      verified = await verifyAccessToken(token);
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
  }
  return {
    async issue(input) {
      let accessToken: string;
      let requestId: string;
      let principalId: string;
      let expiresAt: number;
      try {
        const value = request(input, ['accessToken', 'requestId', 'principalId', 'expiresAt']);
        const token = value.accessToken;
        const id = value.requestId;
        const owner = value.principalId;
        const expiry = value.expiresAt;
        if (
          !opaque(token, 16384) ||
          !opaque(id, 256) ||
          !opaque(owner, 256) ||
          typeof expiry !== 'number' ||
          !Number.isSafeInteger(expiry) ||
          expiry < 0
        )
          throw new InvalidSsoTokenManagementInput();
        accessToken = token;
        requestId = id;
        principalId = owner;
        expiresAt = expiry;
      } catch {
        throw new InvalidSsoTokenManagementInput();
      }
      return management.issue({
        authenticatedActorId: await authenticate(accessToken),
        requestId,
        principalId,
        expiresAt,
      });
    },
    async revoke(input) {
      let accessToken: string;
      let requestId: string;
      let credentialId: string;
      try {
        const value = request(input, ['accessToken', 'requestId', 'credentialId']);
        const token = value.accessToken;
        const id = value.requestId;
        const credential = value.credentialId;
        if (!opaque(token, 16384) || !opaque(id, 256) || !opaque(credential, 256))
          throw new InvalidSsoTokenManagementInput();
        accessToken = token;
        requestId = id;
        credentialId = credential;
      } catch {
        throw new InvalidSsoTokenManagementInput();
      }
      return management.revoke({
        authenticatedActorId: await authenticate(accessToken),
        requestId,
        credentialId,
      });
    },
  };
}
export function createPostgresRfc9068SsoTokenManagementService(
  ports: SsoAccessTokenConfiguration & { readonly client: CredentialSqlClient },
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
    const verifyAccessToken = createRfc9068SsoAccessTokenVerifier({ issuer, audience, jwks, now });
    return createPostgresSsoTokenManagementService({ client, now, verifyAccessToken });
  } catch {
    throw new InvalidSsoAccessTokenConfiguration();
  }
}
