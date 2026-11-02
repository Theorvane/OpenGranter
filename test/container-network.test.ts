import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('container CI covers host and explicit bridge networking', async () => {
  const text = await readFile(
    new URL('../.github/workflows/container.yml', import.meta.url),
    'utf8',
  );
  for (const value of [
    'network: [host, bridge]',
    'fail-fast: false',
    'CONTAINER_NETWORK_MODE:',
    'job.services.postgres.id',
    '.NetworkSettings.Networks',
    'OPENGRANTER_HOST=0.0.0.0',
    '127.0.0.1:18080:18080',
    'PGHOST',
  ])
    assert.ok(text.includes(value), value);
});

test('container CI checks persisted catalog and migration history across restart', async () => {
  const text = await readFile(
    new URL('../.github/workflows/container.yml', import.meta.url),
    'utf8',
  );
  for (const value of [
    'INSERT INTO catalog_models',
    'restart-probe',
    'schema_migrations ORDER BY version',
    'migration_history_before',
    'migration_history_after',
    'docker start opengranter-smoke',
    'for phase in initial restarted',
    'persisted_model',
  ])
    assert.ok(text.includes(value), value);
});

test('container CI restores a cold disposable PostgreSQL archive before reopening', async () => {
  const text = await readFile(
    new URL('../.github/workflows/container.yml', import.meta.url),
    'utf8',
  );
  for (const value of [
    'for phase in initial restarted restored',
    'if [[ "$phase" == restored ]]',
    'pg_dump -U postgres --format=custom --no-owner --no-privileges postgres',
    '{{.State.Running}}',
    'test -s "$fixture/recovery.dump"',
    'chmod 600 "$fixture/recovery.dump"',
    'DELETE FROM catalog_models WHERE alias =',
    'test -z "$deleted_model"',
    'pg_restore -U postgres --exit-on-error --clean --if-exists --no-owner --no-privileges -d postgres',
    'docker exec -i "$POSTGRES_CONTAINER"',
    'test "$restored_model" = "restart-probe|f"',
    'test "$migration_history_before" = "$restored_history"',
    'test "$phase" != initial',
    'checkLimit: async () => false',
    'No provider credentials in smoke test',
  ])
    assert.ok(text.includes(value), value);
  const start = text.indexOf('if [[ "$phase" == restored ]]');
  const dump = text.indexOf('pg_dump -U postgres', start);
  const remove = text.indexOf('DELETE FROM catalog_models', dump);
  const absent = text.indexOf('test -z "$deleted_model"', remove);
  const restore = text.indexOf('pg_restore -U postgres', absent);
  const data = text.indexOf('test "$restored_model"', restore);
  const history = text.indexOf('test "$migration_history_before" = "$restored_history"', data);
  const reopen = text.indexOf('docker start opengranter-smoke', history);
  assert.ok(start < dump && dump < remove && remove < absent && absent < restore);
  assert.ok(restore < data && data < history && history < reopen);
  assert.ok(text.indexOf('test "$status" = 401', reopen) > reopen);
  assert.ok(text.indexOf('docker stop --time 40 opengranter-smoke', reopen) > reopen);
});
