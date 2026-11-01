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
