import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { exportJWK, generateSecret, SignJWT, UnsecuredJWT } from 'jose';
import { createRfc9068SsoAccessTokenVerifier } from '../src/identity/rfc9068-sso-access-tokens.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const fixture = await createSsoAccessTokenFixture();
const other = await createSsoAccessTokenFixture();
const { nowSeconds: now, config } = fixture;
type Config = Parameters<typeof createRfc9068SsoAccessTokenVerifier>[0];
function fixed(name: string, message: string) {
  return (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, name);
    assert.equal(error.message, message);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error), ['name']);
    return true;
  };
}
const invalid = fixed(
  'InvalidSsoAccessTokenConfiguration',
  'Invalid SSO access token configuration',
);
const unavailable = fixed(
  'SsoAccessTokenVerificationUnavailable',
  'SSO access token verification unavailable',
);

test('real RS256 access verification returns only a frozen exact issuer/subject', async () => {
  const verify = createRfc9068SsoAccessTokenVerifier(config);
  const value = await verify(await fixture.token({ role: 'admin', principalId: 'forged' }));
  assert.deepEqual(value, { issuer: fixture.issuer, subject: fixture.subject });
  assert.ok(Object.isFrozen(value));
});

for (const typ of ['at+jwt', 'AT+JWT', 'application/at+jwt', 'APPLICATION/AT+JWT']) {
  test(`RFC media typing accepts ${typ}`, async () => {
    assert.ok(await createRfc9068SsoAccessTokenVerifier(config)(await fixture.token({}, { typ })));
  });
}
for (const typ of [undefined, 'JWT', 'id+jwt', 'application/jwt', '', null, 1]) {
  test(`access verifier denies other token type ${String(typ)}`, async () => {
    assert.equal(
      await createRfc9068SsoAccessTokenVerifier(config)(await fixture.token({}, { typ })),
      undefined,
    );
  });
}

test('verifier denies wrong key, signature, kid, symmetric and unsigned tokens', async () => {
  const verify = createRfc9068SsoAccessTokenVerifier(config);
  assert.equal(
    await verify(await other.token({ iss: fixture.issuer, sub: fixture.subject })),
    undefined,
  );
  const signed = await fixture.token();
  const parts = signed.split('.');
  const signature = parts[2];
  assert.ok(signature);
  parts[2] = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  assert.equal(await verify(parts.join('.')), undefined);
  assert.equal(await verify(await fixture.token({}, { kid: 'unknown' })), undefined);
  const secret = await generateSecret('HS256');
  const symmetric = await new SignJWT(fixture.claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'current' })
    .sign(secret);
  assert.equal(await verify(symmetric), undefined);
  assert.equal(await verify(new UnsecuredJWT(fixture.claims).encode()), undefined);
});

test('one local key permits absent kid, overlap rotation uses exact kid and ambiguous selection denies', async () => {
  const single = createRfc9068SsoAccessTokenVerifier(config);
  assert.ok(await single(await fixture.token({}, { kid: undefined })));
  const overlap = createRfc9068SsoAccessTokenVerifier({
    ...config,
    jwks: { keys: [fixture.publicJwk, { ...other.publicJwk, kid: 'previous' }] },
  });
  assert.ok(await overlap(await fixture.token()));
  assert.ok(
    await overlap(
      await other.token({ iss: fixture.issuer, sub: fixture.subject }, { kid: 'previous' }),
    ),
  );
  assert.equal(await overlap(await fixture.token({}, { kid: undefined })), undefined);
  const rebuilt = createRfc9068SsoAccessTokenVerifier({
    ...config,
    jwks: { keys: [{ ...other.publicJwk, kid: 'previous' }] },
  });
  assert.equal(await rebuilt(await fixture.token()), undefined);
});

for (const claim of ['iss', 'sub', 'aud', 'exp', 'iat', 'jti', 'client_id', 'auth_time']) {
  test(`verifier requires ${claim}`, async () => {
    assert.equal(
      await createRfc9068SsoAccessTokenVerifier(config)(
        await fixture.token({ [claim]: undefined }),
      ),
      undefined,
    );
  });
}
const badClaims: readonly [string, Record<string, unknown>][] = [
  ['wrong issuer', { iss: `${fixture.issuer}/` }],
  ['wrong audience', { aud: 'urn:other' }],
  ['mixed malformed audience', { aud: [fixture.audience, 1] }],
  ['oversized audience array', { aud: Array(65).fill(fixture.audience) }],
  ['blank audience member', { aud: [fixture.audience, ''] }],
  ['oversized audience member', { aud: [fixture.audience, 'x'.repeat(257)] }],
  ['subject null', { sub: null }],
  ['empty subject', { sub: '' }],
  ['oversized subject', { sub: 'x'.repeat(257) }],
  ['subject NUL', { sub: 'x\0y' }],
  ['subject surrogate', { sub: '\ud800' }],
  ['client number', { client_id: 1 }],
  ['empty client', { client_id: '' }],
  ['oversized client', { client_id: 'x'.repeat(257) }],
  ['jti number', { jti: 1 }],
  ['empty jti', { jti: '' }],
  ['jti NUL', { jti: 'x\0y' }],
  ['oversized jti', { jti: 'x'.repeat(257) }],
  ['negative iat', { iat: -1 }],
  ['string iat', { iat: String(now) }],
  ['null expiry', { exp: null }],
  ['infinite expiry', { exp: Infinity }],
  ['zero duration', { exp: now - 10 }],
  ['reversed duration', { exp: now - 11 }],
  ['duration beyond one hour', { exp: now - 10 + 3600.1 }],
  ['expiry at skew cutoff', { iat: now - 100, exp: now - 60, auth_time: now - 200 }],
  ['expiry beyond skew', { iat: now - 100, exp: now - 60.1, auth_time: now - 200 }],
  ['future iat beyond skew', { iat: now + 60.1, exp: now + 3600 + 60.1 }],
  ['old issuance beyond age/skew', { iat: now - 3660.1, exp: now - 60.1, auth_time: now - 4000 }],
  ['future nbf beyond skew', { nbf: now + 60.1 }],
  ['nbf at expiry', { nbf: now + 3500 }],
  ['negative nbf', { nbf: -1 }],
  ['auth_time null', { auth_time: null }],
  ['auth_time string', { auth_time: String(now - 100) }],
  ['negative auth_time', { auth_time: -1 }],
  ['future auth_time after iat', { auth_time: now - 9.9 }],
];
for (const [name, patch] of badClaims) {
  test(`signed access token denies ${name}`, async () => {
    assert.equal(
      await createRfc9068SsoAccessTokenVerifier(config)(await fixture.token(patch)),
      undefined,
    );
  });
}

for (const [name, patch] of [
  ['maximum lifetime', { exp: now - 10 + 3600 }],
  ['fractional NumericDates', { iat: now - 10.5, exp: now + 3500.25, auth_time: now - 100.75 }],
  ['expiry inside tolerance', { iat: now - 100, exp: now - 59.5, auth_time: now - 200 }],
  ['old issuance inside age/skew', { iat: now - 3659, exp: now - 59, auth_time: now - 4000 }],
  ['future issuance at skew', { iat: now + 60, exp: now + 3660 }],
  ['future not-before at skew', { nbf: now + 60 }],
  ['original login predates refresh', { auth_time: 0 }],
  ['audience membership', { aud: ['urn:other', fixture.audience] }],
  ['maximum audience list', { aud: Array(64).fill(fixture.audience) }],
  ['maximum Unicode subject', { sub: '😀'.repeat(128) }],
  ['large ignored claims', { extra: 'x'.repeat(10000) }],
] as const) {
  test(`valid access profile accepts ${name}`, async () => {
    assert.ok(await createRfc9068SsoAccessTokenVerifier(config)(await fixture.token(patch)));
  });
}

test('caller header keys/URLs neither replace registered keys nor trigger network access', async () => {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    throw Error('Must not fetch caller keys');
  };
  try {
    const verify = createRfc9068SsoAccessTokenVerifier(config);
    const headers = {
      jku: 'https://unregistered.example/keys',
      x5u: 'https://unregistered.example/cert',
      jwk: other.publicJwk,
    };
    assert.ok(await verify(await fixture.token({}, headers)));
    assert.equal(await verify(await other.token({ iss: fixture.issuer }, headers)), undefined);
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = original;
  }
});

const small = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({
  format: 'jwk',
});
const privateJwk = await exportJWK(fixture.privateKey);
const badConfigs: readonly [string, unknown][] = [
  ['null', null],
  ['array', []],
  ['inherited config', Object.create(config)],
  ['missing issuer', { ...config, issuer: undefined }],
  ['HTTP issuer', { ...config, issuer: 'http://sso.example' }],
  ['issuer credentials', { ...config, issuer: 'https://user:pass@sso.example' }],
  ['issuer query', { ...config, issuer: 'https://sso.example?x=1' }],
  ['issuer fragment', { ...config, issuer: 'https://sso.example#x' }],
  ['issuer whitespace', { ...config, issuer: ` ${fixture.issuer}` }],
  ['oversized issuer', { ...config, issuer: 'https://sso.example/' + 'x'.repeat(2048) }],
  ['empty audience', { ...config, audience: '' }],
  ['audience NUL', { ...config, audience: 'x\0y' }],
  ['oversized audience', { ...config, audience: 'x'.repeat(257) }],
  ['missing clock', { ...config, now: undefined }],
  ['null JWKS', { ...config, jwks: null }],
  ['empty keys', { ...config, jwks: { keys: [] } }],
  [
    'too many keys',
    {
      ...config,
      jwks: {
        keys: Array.from({ length: 17 }, (_, index) => ({
          ...fixture.publicJwk,
          kid: String(index),
        })),
      },
    },
  ],
  ['duplicate IDs', { ...config, jwks: { keys: [fixture.publicJwk, fixture.publicJwk] } }],
  ['inherited key', { ...config, jwks: { keys: [Object.create(fixture.publicJwk)] } }],
  ['key hole', { ...config, jwks: { keys: new Array(1) } }],
  ['private key', { ...config, jwks: { keys: [{ ...privateJwk, kid: 'current' }] } }],
  ['weak RSA', { ...config, jwks: { keys: [{ ...small, kid: 'current' }] } }],
  ['non-RSA key', { ...config, jwks: { keys: [{ ...fixture.publicJwk, kty: 'oct' }] } }],
  [
    'noncanonical modulus',
    { ...config, jwks: { keys: [{ ...fixture.publicJwk, n: fixture.publicJwk.n + '=' }] } },
  ],
  [
    'leading-zero modulus',
    {
      ...config,
      jwks: {
        keys: [
          {
            ...fixture.publicJwk,
            n: Buffer.concat([
              Buffer.of(0),
              Buffer.from(fixture.publicJwk.n, 'base64url'),
            ]).toString('base64url'),
          },
        ],
      },
    },
  ],
  ['invalid exponent', { ...config, jwks: { keys: [{ ...fixture.publicJwk, e: 'AA' }] } }],
  ['wrong alg', { ...config, jwks: { keys: [{ ...fixture.publicJwk, alg: 'HS256' }] } }],
  ['wrong usage', { ...config, jwks: { keys: [{ ...fixture.publicJwk, use: 'enc' }] } }],
  ['wrong key ops', { ...config, jwks: { keys: [{ ...fixture.publicJwk, key_ops: ['sign'] }] } }],
  [
    'unknown own key field',
    { ...config, jwks: { keys: [{ ...fixture.publicJwk, unknown: 'private fixture' }] } },
  ],
  [
    'throwing config',
    {
      ...config,
      get issuer() {
        throw Error('private config fixture');
      },
    },
  ],
  [
    'throwing key',
    {
      ...config,
      jwks: {
        keys: [
          {
            ...fixture.publicJwk,
            get n() {
              throw Error('private key fixture');
            },
          },
        ],
      },
    },
  ],
];
for (const [name, value] of badConfigs) {
  test(`verifier configuration rejects ${name} privately`, () => {
    assert.throws(() => createRfc9068SsoAccessTokenVerifier(value as Config), invalid);
  });
}

test('configuration getters are captured once; later config/key/algorithm changes cannot change trust', async () => {
  const counts = new Map<string, number>();
  const key: Record<string, unknown> = {};
  for (const [name, value] of Object.entries({
    ...fixture.publicJwk,
    alg: 'RS256',
    use: 'sig',
    key_ops: ['verify'],
  }))
    Object.defineProperty(key, name, {
      get() {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        assert.equal(counts.get(name), 1);
        return value;
      },
    });
  let issuer = fixture.issuer;
  let keys: unknown[] = [key];
  let issuerReads = 0;
  let keysReads = 0;
  let clockReads = 0;
  let clockCalls = 0;
  const input = {
    get issuer() {
      issuerReads++;
      return issuer;
    },
    audience: fixture.audience,
    jwks: {
      get keys() {
        keysReads++;
        return keys;
      },
    },
    get now() {
      clockReads++;
      return () => {
        clockCalls++;
        return now * 1000;
      };
    },
  };
  const verify = createRfc9068SsoAccessTokenVerifier(input);
  issuer = 'https://other.example';
  keys = [other.publicJwk];
  assert.ok(await verify(await fixture.token()));
  assert.equal(issuerReads, 1);
  assert.equal(keysReads, 1);
  assert.equal(clockReads, 1);
  assert.equal(clockCalls, 1);
  assert.equal(counts.size, 7);
});

test('key list and key-operation custom iterators are never invoked', async () => {
  const keys = [{ ...fixture.publicJwk, key_ops: ['verify'] }];
  keys[Symbol.iterator] = () => {
    throw Error('Untrusted key iterator');
  };
  const first = keys[0];
  assert.ok(first);
  first.key_ops[Symbol.iterator] = () => {
    throw Error('Untrusted operation iterator');
  };
  assert.ok(
    await createRfc9068SsoAccessTokenVerifier({ ...config, jwks: { keys } })(await fixture.token()),
  );
});

for (const [name, clock] of [
  [
    'throws',
    () => {
      throw Error('private clock fixture');
    },
  ],
  ['NaN', () => NaN],
  ['negative', () => -1],
  ['fractional ms', () => 0.5],
  ['outside Date range', () => 8_640_000_000_000_001],
] as const) {
  test(`invalid runtime clock reports safe availability: ${name}`, async () => {
    await assert.rejects(
      createRfc9068SsoAccessTokenVerifier({ ...config, now: clock })(await fixture.token()),
      unavailable,
    );
  });
}

test('malformed, oversized, NUL and proxy tokens are rejected without leaking data', async () => {
  let clocks = 0;
  const verify = createRfc9068SsoAccessTokenVerifier({
    ...config,
    now: () => {
      clocks++;
      return now * 1000;
    },
  });
  for (const token of [null, undefined, 1, '', 'x'.repeat(16385), '\ud800', 'x\0y'])
    assert.equal(await verify(token as string), undefined);
  assert.equal(clocks, 0);
  for (const token of [
    'not-a-jwt',
    'og1_fixture_fixture',
    `${await fixture.token()}extra`,
    await fixture.token({ extra: 'x'.repeat(15000) }),
  ])
    assert.equal(await verify(token), undefined);
});

test('unexpected cryptographic engine failure exposes only safe verification availability', async () => {
  const signed = await fixture.token();
  const subtle = globalThis.crypto.subtle;
  const original = Object.getOwnPropertyDescriptor(subtle, 'importKey');
  Object.defineProperty(subtle, 'importKey', {
    configurable: true,
    value: async () => {
      throw Error('private cryptographic engine failure');
    },
  });
  try {
    await assert.rejects(createRfc9068SsoAccessTokenVerifier(config)(signed), unavailable);
  } finally {
    if (original) Object.defineProperty(subtle, 'importKey', original);
    else Reflect.deleteProperty(subtle, 'importKey');
  }
});
