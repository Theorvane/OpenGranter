import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';

async function migrated(run: (db: PGlite) => Promise<void>) {
  const db = new PGlite();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await run(db);
  } finally {
    await db.close();
  }
}
test('migrated SSO binding storage starts empty and keeps exact issuer/subject identities', async () => {
  await migrated(async (db) => {
    const empty = await db.query(
      'SELECT issuer, subject, principal_id FROM iam_sso_identity_bindings',
    );
    assert.deepEqual(empty.rows, []);
    await db.exec(
      "INSERT INTO iam_principals VALUES ('human-one','human',true),('human-two','human',true)",
    );
    for (const [issuer, subject, principal] of [
      ['https://sso.example', 'Alpha', 'human-one'],
      ['https://sso.example', 'alpha', 'human-two'],
      ['https://other.example', 'Alpha', 'human-two'],
      ['https://sso.example/', 'Alpha', 'human-two'],
      ['https://sso.example', ' 유저😀 ', 'human-one'],
    ])
      await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
        issuer,
        subject,
        principal,
      ]);
    const rows = await db.query(
      'SELECT principal_id FROM iam_sso_identity_bindings WHERE issuer=$1 AND subject=$2',
      ['https://sso.example', 'Alpha'],
    );
    assert.deepEqual(rows.rows, [{ principal_id: 'human-one' }]);
    const humans = await db.query('SELECT count(*)::int AS count FROM iam_principals');
    assert.deepEqual(humans.rows, [{ count: 2 }]);
    const bindings = await db.query('SELECT count(*)::int AS count FROM iam_sso_identity_bindings');
    assert.deepEqual(bindings.rows, [{ count: 5 }]);
    const collation = await db.query(
      "SELECT attname,collname FROM pg_attribute JOIN pg_collation ON attcollation=pg_collation.oid WHERE attrelid='iam_sso_identity_bindings'::regclass AND attname IN ('issuer','subject') ORDER BY attname",
    );
    assert.deepEqual(collation.rows, [
      { attname: 'issuer', collname: 'C' },
      { attname: 'subject', collname: 'C' },
    ]);
  });
});
test('SSO binding keys enforce uniqueness/FK/restricted deletion and bounded nonempty strings', async () => {
  await migrated(async (db) => {
    await db.exec("INSERT INTO iam_principals VALUES ('human','human',true)");
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      'issuer',
      'subject',
      'human',
    ]);
    for (const [issuer, subject, principal, code] of [
      ['issuer', 'subject', 'human', '23505'],
      ['missing', 'subject', 'missing', '23503'],
      ['', 'subject', 'human', '23514'],
      ['issuer', '', 'human', '23514'],
      ['x'.repeat(2049), 'subject', 'human', '23514'],
      ['issuer', 'x'.repeat(257), 'human', '23514'],
    ])
      await assert.rejects(
        db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
          issuer,
          subject,
          principal,
        ]),
        (error) => {
          assert.ok(error instanceof Error && 'code' in error);
          assert.equal(error.code, code);
          return true;
        },
      );
    await assert.rejects(
      db.query('DELETE FROM iam_principals WHERE principal_id=$1', ['human']),
      (error) => {
        assert.ok(error instanceof Error && 'code' in error);
        assert.equal(error.code, '23503');
        return true;
      },
    );
    const left = await db.query('SELECT principal_id FROM iam_sso_identity_bindings');
    assert.deepEqual(left.rows, [{ principal_id: 'human' }]);
  });
});
test('trusted migration bundle includes the new SSO binding migration without editing historical sources', async () => {
  const sources = await loadPostgresMigrationSources();
  assert.equal(sources.length, 11);
  assert.equal(sources.at(-1)?.version, '011');
  assert.match(sources.at(-1)?.sql ?? '', /CREATE TABLE iam_sso_identity_bindings/u);
});
