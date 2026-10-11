import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresSsoIdentityBindingReader,
  type SsoIdentityBindingSqlClient,
} from '../src/identity/postgres-sso-identity-bindings.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';

const identity = { issuer: 'https://sso.example', subject: 'user' };
const human = { ...identity, principal_id: 'human', kind: 'human', active: true };
type Input = Parameters<
  ReturnType<typeof createPostgresSsoIdentityBindingReader>['resolveHumanPrincipal']
>[0];
type SqlResult = Awaited<ReturnType<SsoIdentityBindingSqlClient['query']>>;
function readerReturning(value: unknown) {
  return createPostgresSsoIdentityBindingReader({ query: async () => value as SqlResult });
}
function safeError(name: string, message: string) {
  return (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, name);
    assert.equal(error.message, message);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error), ['name']);
    return true;
  };
}
const invalid = safeError('InvalidSsoIdentityBindingInput', 'Invalid SSO identity binding input');
const unavailable = safeError('SsoIdentityBindingUnavailable', 'SSO identity binding unavailable');

test('binding reader projects exact parameters into one joined read and returns only the human ID', async () => {
  let reads = 0;
  const raw = { issuer: " https://sso.example/' ", subject: ' 유저😀 ' };
  const reader = createPostgresSsoIdentityBindingReader({
    async query(sql, params) {
      reads++;
      assert.match(sql, /JOIN iam_principals/u);
      assert.match(sql, /b\.issuer = \$1 AND b\.subject = \$2/u);
      assert.ok(!sql.includes(raw.issuer) && !sql.includes(raw.subject));
      assert.deepEqual(params, [raw.issuer, raw.subject]);
      assert.ok(Object.isFrozen(params));
      assert.throws(() => (params as unknown[]).push('forged'));
      return { rows: [{ ...raw, principal_id: 'human', kind: 'human', active: true }] };
    },
  });
  assert.equal(await reader.resolveHumanPrincipal(raw), 'human');
  assert.equal(reads, 1);
});

for (const [name, rows] of [
  ['missing binding', []],
  ['inactive human', [{ ...human, active: false }]],
  ['active service', [{ ...human, kind: 'service' }]],
  ['inactive service', [{ ...human, kind: 'service', active: false }]],
] as const) {
  test(`binding reader denies ${name} despite forged extra caller state`, async () => {
    const reader = readerReturning({ rows });
    const input = {
      ...identity,
      principalId: 'admin',
      kind: 'human',
      active: true,
      email: 'user@example.test',
      token: 'fixture-only',
    };
    assert.equal(await reader.resolveHumanPrincipal(input), undefined);
  });
}

test('binding reader captures own required claims once before asynchronous query mutation', async () => {
  let issuerReads = 0;
  let subjectReads = 0;
  let value = 'https://sso.example';
  const input = {
    get issuer() {
      assert.equal(++issuerReads, 1);
      return value;
    },
    get subject() {
      assert.equal(++subjectReads, 1);
      return 'user';
    },
    get principalId() {
      throw Error('Extra caller field must not be read');
    },
  };
  const reader = createPostgresSsoIdentityBindingReader({
    async query(_sql, params) {
      value = 'https://other.example';
      await Promise.resolve();
      assert.deepEqual(params, [identity.issuer, identity.subject]);
      return { rows: [human] };
    },
  });
  assert.equal(await reader.resolveHumanPrincipal(input), 'human');
  assert.equal(issuerReads, 1);
  assert.equal(subjectReads, 1);
});

test('binding reader reads result properties once and ignores unneeded result fields', async () => {
  const counts = new Map<string, number>();
  const row = {};
  for (const [key, value] of Object.entries(human)) {
    Object.defineProperty(row, key, {
      get() {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        assert.equal(count, 1);
        return value;
      },
    });
  }
  Object.defineProperty(row, 'email', {
    get() {
      throw Error('Unneeded field');
    },
  });
  let rowsReads = 0;
  const result = {
    get rows() {
      assert.equal(++rowsReads, 1);
      return [row];
    },
  };
  assert.equal(await readerReturning(result).resolveHumanPrincipal(identity), 'human');
  assert.equal(rowsReads, 1);
  assert.equal(counts.size, 5);
});

const invalidInputs: readonly [string, unknown][] = [
  ['null', null],
  ['array', []],
  ['string', 'raw-private-fixture'],
  ['missing issuer', { subject: 'user' }],
  ['missing subject', { issuer: identity.issuer }],
  ['inherited claims', Object.create(identity)],
  ['empty issuer', { ...identity, issuer: '' }],
  ['empty subject', { ...identity, subject: '' }],
  ['oversized issuer', { ...identity, issuer: 'x'.repeat(2049) }],
  ['oversized subject', { ...identity, subject: 'x'.repeat(257) }],
  ['non-string issuer', { ...identity, issuer: 1 }],
  ['non-string subject', { ...identity, subject: true }],
  ['NUL issuer', { ...identity, issuer: 'x\0y' }],
  ['NUL subject', { ...identity, subject: 'x\0y' }],
  ['high surrogate issuer', { ...identity, issuer: '\ud800' }],
  ['low surrogate issuer', { ...identity, issuer: '\udfff' }],
  ['high surrogate subject', { ...identity, subject: '\ud800x' }],
  ['low surrogate subject', { ...identity, subject: 'x\udfff' }],
  ['overlong UTF-16 subject', { ...identity, subject: '😀'.repeat(129) }],
  [
    'throwing issuer',
    {
      get issuer() {
        throw Error('private claim fixture');
      },
      subject: 'user',
    },
  ],
  [
    'throwing subject',
    {
      issuer: identity.issuer,
      get subject() {
        throw Error('private claim fixture');
      },
    },
  ],
];
for (const [name, input] of invalidInputs) {
  test(`invalid binding input fails before SQL: ${name}`, async () => {
    let reads = 0;
    const reader = createPostgresSsoIdentityBindingReader({
      query: async () => {
        reads++;
        return { rows: [human] };
      },
    });
    await assert.rejects(reader.resolveHumanPrincipal(input as Input), invalid);
    assert.equal(reads, 0);
  });
}

for (const [name, input] of [
  ['maximum lengths', { issuer: 'x'.repeat(2048), subject: 'x'.repeat(256) }],
  ['maximum UTF-16 subject', { issuer: 'https://sso.example/', subject: '😀'.repeat(128) }],
  ['exact whitespace', { issuer: ' ', subject: ' ' }],
  ['combining Unicode', { issuer: 'https://sso.example', subject: 'e\u0301' }],
] as const) {
  test(`binding reader preserves valid opaque identity: ${name}`, async () => {
    assert.equal(
      await readerReturning({ rows: [{ ...human, ...input }] }).resolveHumanPrincipal(input),
      'human',
    );
  });
}

const malformedResults: readonly [string, unknown][] = [
  ['null result', null],
  ['missing rows', {}],
  ['non-array rows', { rows: {} }],
  ['null rows', { rows: null }],
  ['hole', { rows: new Array(1) }],
  ['duplicates', { rows: [human, human] }],
  ['null row', { rows: [null] }],
  ['array row', { rows: [[]] }],
  ['primitive row', { rows: ['private row fixture'] }],
  ['inherited row', { rows: [Object.create(human)] }],
  ['wrong issuer', { rows: [{ ...human, issuer: 'https://other.example' }] }],
  ['wrong subject', { rows: [{ ...human, subject: 'User' }] }],
  [
    'missing principal',
    { rows: [{ issuer: identity.issuer, subject: identity.subject, kind: 'human', active: true }] },
  ],
  ['empty principal', { rows: [{ ...human, principal_id: '' }] }],
  ['oversized principal', { rows: [{ ...human, principal_id: 'x'.repeat(257) }] }],
  ['invalid Unicode principal', { rows: [{ ...human, principal_id: '\ud800' }] }],
  ['NUL principal', { rows: [{ ...human, principal_id: 'x\0y' }] }],
  ['non-string principal', { rows: [{ ...human, principal_id: 7 }] }],
  ['invalid kind', { rows: [{ ...human, kind: 'admin' }] }],
  ['string active', { rows: [{ ...human, active: 'true' }] }],
  ['missing active', { rows: [{ ...identity, principal_id: 'human', kind: 'human' }] }],
  ['malformed denial', { rows: [{ ...human, principal_id: '', kind: 'service', active: false }] }],
  [
    'throwing rows',
    {
      get rows() {
        throw Error('private result fixture');
      },
    },
  ],
  [
    'throwing principal',
    {
      rows: [
        {
          ...human,
          get principal_id() {
            throw Error('private result fixture');
          },
        },
      ],
    },
  ],
];
for (const [name, result] of malformedResults) {
  test(`binding reader rejects unsafe persistence result: ${name}`, async () => {
    await assert.rejects(readerReturning(result).resolveHumanPrincipal(identity), unavailable);
  });
}

test('binding reader sanitizes driver failure without claims, messages or cause', async () => {
  const reader = createPostgresSsoIdentityBindingReader({
    query: async () => {
      throw Error('private query/issuer/token fixture');
    },
  });
  await assert.rejects(reader.resolveHumanPrincipal(identity), unavailable);
});

test('migrated binding reader sees current exact identities and principal state without account or policy writes', async () => {
  const db = new PGlite();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(
      "INSERT INTO iam_principals VALUES ('human','human',true),('other','human',true),('service','service',true)",
    );
    for (const [issuer, subject, principal] of [
      [identity.issuer, identity.subject, 'human'],
      [identity.issuer, 'User', 'other'],
      ['https://other.example', identity.subject, 'other'],
      [identity.issuer, ' 유저😀 ', 'human'],
      [identity.issuer, 'service', 'service'],
    ])
      await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
        issuer,
        subject,
        principal,
      ]);
    const reader = createPostgresSsoIdentityBindingReader({
      query: (sql, params) => db.query(sql, [...params]),
    });
    assert.equal(await reader.resolveHumanPrincipal(identity), 'human');
    assert.equal(await reader.resolveHumanPrincipal({ ...identity, subject: 'User' }), 'other');
    assert.equal(
      await reader.resolveHumanPrincipal({ ...identity, issuer: 'https://other.example' }),
      'other',
    );
    assert.equal(await reader.resolveHumanPrincipal({ ...identity, subject: ' 유저😀 ' }), 'human');
    for (const input of [
      { ...identity, issuer: `${identity.issuer}/` },
      { ...identity, subject: ' user' },
      { ...identity, subject: 'missing' },
      { ...identity, subject: 'service' },
    ])
      assert.equal(await reader.resolveHumanPrincipal(input), undefined);
    await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human'");
    assert.equal(await reader.resolveHumanPrincipal(identity), undefined);
    await db.exec(
      "UPDATE iam_principals SET active=true,kind='service' WHERE principal_id='human'",
    );
    assert.equal(await reader.resolveHumanPrincipal(identity), undefined);
    await db.query(
      'UPDATE iam_sso_identity_bindings SET principal_id=$3 WHERE issuer=$1 AND subject=$2',
      [identity.issuer, identity.subject, 'other'],
    );
    assert.equal(await reader.resolveHumanPrincipal(identity), 'other');
    await db.query('DELETE FROM iam_sso_identity_bindings WHERE issuer=$1 AND subject=$2', [
      identity.issuer,
      identity.subject,
    ]);
    assert.equal(await reader.resolveHumanPrincipal(identity), undefined);
    assert.deepEqual((await db.query('SELECT count(*)::int AS count FROM iam_principals')).rows, [
      { count: 3 },
    ]);
    assert.deepEqual((await db.query('SELECT count(*)::int AS count FROM iam_policies')).rows, [
      { count: 0 },
    ]);
  } finally {
    await db.close();
  }
});
