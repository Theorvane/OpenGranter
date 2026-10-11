import assert from 'node:assert/strict';
import { CompactSign, exportJWK, generateKeyPair, type JWTHeaderParameters } from 'jose';

/** Signing material exists only in memory; no private key/token fixtures are persisted. */
export async function createSsoAccessTokenFixture() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const exported = await exportJWK(publicKey);
  assert.equal(exported.kty, 'RSA');
  assert.ok(typeof exported.n === 'string' && typeof exported.e === 'string');
  const publicJwk = { kty: 'RSA', kid: 'current', n: exported.n, e: exported.e };
  const nowSeconds = 2_000_000_000;
  const issuer = 'https://sso.example/private-issuer-fixture';
  const audience = 'urn:opengranter:management';
  const subject = 'private-subject-fixture';
  const claims = {
    iss: issuer,
    sub: subject,
    aud: audience,
    iat: nowSeconds - 10,
    exp: nowSeconds + 3500,
    client_id: 'human-ui',
    jti: 'fixture-jti',
    auth_time: nowSeconds - 100,
  };
  return {
    privateKey,
    publicKey,
    publicJwk,
    nowSeconds,
    issuer,
    audience,
    subject,
    claims,
    config: { issuer, audience, jwks: { keys: [publicJwk] }, now: () => nowSeconds * 1000 },
    token: (patch: Record<string, unknown> = {}, header: Record<string, unknown> = {}) =>
      new CompactSign(
        new TextEncoder().encode(
          JSON.stringify({ ...claims, ...patch }, (_key, value) =>
            value === Infinity ? '__numeric_overflow__' : value,
          ).replaceAll('"__numeric_overflow__"', '1e999'),
        ),
      )
        .setProtectedHeader({
          alg: 'RS256',
          typ: 'at+jwt',
          kid: 'current',
          ...header,
        } as JWTHeaderParameters)
        .sign(privateKey),
  };
}
