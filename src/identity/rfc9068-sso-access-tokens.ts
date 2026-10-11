import { createPublicKey } from 'node:crypto';
import { createLocalJWKSet, errors, type JWK, jwtVerify } from 'jose';

export interface SsoAccessTokenConfiguration {
  readonly issuer: string;
  readonly audience: string;
  readonly jwks: unknown;
  readonly now: () => number;
}
export interface VerifiedSsoIdentity {
  readonly issuer: string;
  readonly subject: string;
}
export class InvalidSsoAccessTokenConfiguration extends Error {
  constructor() {
    super('Invalid SSO access token configuration');
    this.name = 'InvalidSsoAccessTokenConfiguration';
  }
}
export class SsoAccessTokenVerificationUnavailable extends Error {
  constructor() {
    super('SSO access token verification unavailable');
    this.name = 'SsoAccessTokenVerificationUnavailable';
  }
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    fields.some((field) => !Object.hasOwn(value, field))
  )
    throw new InvalidSsoAccessTokenConfiguration();
  return value as Record<string, unknown>;
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

function rsaInteger(value: unknown, maximumBytes: number): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > Math.ceil((maximumBytes * 4) / 3) ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw new InvalidSsoAccessTokenConfiguration();
  const decoded = Buffer.from(value, 'base64url');
  if (
    !decoded.length ||
    decoded.length > maximumBytes ||
    decoded[0] === 0 ||
    decoded.toString('base64url') !== value
  )
    throw new InvalidSsoAccessTokenConfiguration();
  return value;
}

function publicKeys(value: unknown): JWK[] {
  const keys = record(value, ['keys']).keys;
  if (!Array.isArray(keys)) throw new InvalidSsoAccessTokenConfiguration();
  const length = keys.length;
  if (length < 1 || length > 16) throw new InvalidSsoAccessTokenConfiguration();
  const result: JWK[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(keys, index)) throw new InvalidSsoAccessTokenConfiguration();
    const key = record(keys[index], ['kty', 'n', 'e', 'kid']);
    if (
      Reflect.ownKeys(key).some(
        (field) =>
          typeof field !== 'string' ||
          !['kty', 'n', 'e', 'kid', 'alg', 'use', 'key_ops'].includes(field),
      )
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const kty = key.kty;
    const n = rsaInteger(key.n, 512);
    const e = rsaInteger(key.e, 8);
    const kid = key.kid;
    const alg = Object.hasOwn(key, 'alg') ? key.alg : 'RS256';
    const use = Object.hasOwn(key, 'use') ? key.use : 'sig';
    const operations = Object.hasOwn(key, 'key_ops') ? key.key_ops : ['verify'];
    if (
      kty !== 'RSA' ||
      !opaque(kid, 256) ||
      ids.has(kid) ||
      alg !== 'RS256' ||
      use !== 'sig' ||
      !Array.isArray(operations) ||
      operations.length !== 1 ||
      !Object.hasOwn(operations, 0) ||
      operations[0] !== 'verify'
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const exponent = BigInt(`0x${Buffer.from(e, 'base64url').toString('hex')}`);
    const imported = createPublicKey({ key: { kty, n, e }, format: 'jwk' });
    const bits = imported.asymmetricKeyDetails?.modulusLength;
    if (
      exponent < 3n ||
      exponent % 2n !== 1n ||
      imported.asymmetricKeyType !== 'rsa' ||
      bits === undefined ||
      bits < 2048 ||
      bits > 4096
    )
      throw new InvalidSsoAccessTokenConfiguration();
    ids.add(kid);
    result.push({ kty, n, e, kid, alg: 'RS256', use: 'sig', key_ops: ['verify'] });
  }
  return result;
}

function numericDate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Local administrator trust snapshot; no network discovery or request-selected keys. */
export function createRfc9068SsoAccessTokenVerifier(
  configuration: SsoAccessTokenConfiguration,
): (token: string) => Promise<VerifiedSsoIdentity | undefined> {
  let issuer: string;
  let audience: string;
  let now: () => number;
  let resolveKey: ReturnType<typeof createLocalJWKSet>;
  try {
    const config = record(configuration, ['issuer', 'audience', 'jwks', 'now']);
    const rawIssuer = config.issuer;
    const rawAudience = config.audience;
    const jwks = config.jwks;
    const clock = config.now;
    if (
      !opaque(rawIssuer, 2048) ||
      /\s/.test(rawIssuer) ||
      !opaque(rawAudience, 256) ||
      typeof clock !== 'function'
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const url = new URL(rawIssuer);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      rawIssuer.includes('?') ||
      rawIssuer.includes('#')
    )
      throw new InvalidSsoAccessTokenConfiguration();
    issuer = rawIssuer;
    audience = rawAudience;
    now = clock as () => number;
    resolveKey = createLocalJWKSet({ keys: publicKeys(jwks) });
  } catch {
    throw new InvalidSsoAccessTokenConfiguration();
  }

  return async (token) => {
    if (!opaque(token, 16384)) return undefined;
    let currentDate: Date;
    try {
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8_640_000_000_000_000)
        throw new SsoAccessTokenVerificationUnavailable();
      currentDate = new Date(timestamp);
    } catch {
      throw new SsoAccessTokenVerificationUnavailable();
    }
    try {
      const { payload } = await jwtVerify(token, resolveKey, {
        algorithms: ['RS256'],
        issuer,
        audience,
        typ: 'at+jwt',
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'jti', 'client_id', 'auth_time'],
        maxTokenAge: 3600,
        clockTolerance: 60,
        currentDate,
      });
      const { sub, client_id: clientId, jti, aud, exp, iat, auth_time: authTime, nbf } = payload;
      const validAudience =
        opaque(aud, 256) ||
        (Array.isArray(aud) &&
          aud.length > 0 &&
          aud.length <= 64 &&
          aud.every((item) => opaque(item, 256)));
      if (
        !opaque(sub, 256) ||
        !opaque(clientId, 256) ||
        !opaque(jti, 256) ||
        !validAudience ||
        !numericDate(exp) ||
        !numericDate(iat) ||
        !numericDate(authTime) ||
        exp <= iat ||
        exp - iat > 3600 ||
        authTime > iat ||
        (nbf !== undefined && (!numericDate(nbf) || nbf >= exp))
      )
        return undefined;
      return Object.freeze({ issuer, subject: sub });
    } catch (error) {
      if (error instanceof errors.JOSEError) return undefined;
      throw new SsoAccessTokenVerificationUnavailable();
    }
  };
}
