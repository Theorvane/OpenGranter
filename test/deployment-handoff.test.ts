import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gateIds, validateHandoff } from '../scripts/check-deployment-handoff.ts';

function first(value: ReturnType<typeof manifest>) {
  const gate = value.gates[0];
  assert.ok(gate);
  return gate;
}

const manifest = () => ({
  revision: 'a'.repeat(40),
  imageDigest: `sha256:${'b'.repeat(64)}`,
  baseDigest: `sha256:${'c'.repeat(64)}`,
  configRef: 'protected/config-v1',
  gates: gateIds.map((id) => ({
    id,
    status: 'PASS',
    timestamp: '2026-11-02T12:00:00.000Z',
    owner: 'infra',
    evidenceRef: `reports/${id}.txt`,
  })),
});

test('handoff metadata distinguishes complete claims from blocked and failed claims', () => {
  assert.equal(validateHandoff(manifest()), 'complete-claims');
  for (const status of ['BLOCKED', 'FAIL']) {
    const value = manifest();
    first(value).status = status;
    assert.equal(validateHandoff(value), 'incomplete-claims');
  }
});

test('handoff metadata fails closed on missing duplicate and unknown gates', () => {
  const missing = manifest();
  missing.gates.pop();
  assert.equal(validateHandoff(missing), 'invalid');
  const duplicate = manifest();
  duplicate.gates[1] = first(duplicate);
  assert.equal(validateHandoff(duplicate), 'invalid');
  assert.equal(validateHandoff({ ...manifest(), token: 'never-print-me' }), 'invalid');
  assert.equal(validateHandoff(null), 'invalid');
  assert.equal(validateHandoff([]), 'invalid');
});

test('handoff metadata rejects unsafe references invalid dates unknown fields and malformed pins', () => {
  for (const ref of [
    '../secret',
    '/etc/passwd',
    'https://example.test',
    'report?token=secret',
    'reports//a',
    'reports/./a',
    '',
  ]) {
    assert.equal(validateHandoff({ ...manifest(), configRef: ref }), 'invalid');
  }
  for (const timestamp of ['2026-02-30T00:00:00.000Z', 'yesterday', '2026-11-02']) {
    const value = manifest();
    first(value).timestamp = timestamp;
    assert.equal(validateHandoff(value), 'invalid');
  }
  const value = manifest();
  assert.equal(validateHandoff({ ...value, revision: 'main' }), 'invalid');
  assert.equal(validateHandoff({ ...value, imageDigest: 'latest' }), 'invalid');
  assert.equal(
    validateHandoff({
      ...value,
      gates: [{ ...value.gates[0], password: 'secret' }, ...value.gates.slice(1)],
    }),
    'invalid',
  );
  for (const key of ['owner', 'evidenceRef', 'status']) {
    const changed = manifest();
    Object.assign(first(changed), { [key]: '' });
    assert.equal(validateHandoff(changed), 'invalid');
  }
});

test('handoff CLI returns distinct codes and never echoes input or filesystem errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-'));
  const file = join(dir, 'manifest.json');
  const script = new URL('../scripts/check-deployment-handoff.ts', import.meta.url).pathname;
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
      encoding: 'utf8',
    });
  try {
    await writeFile(file, JSON.stringify(manifest()));
    const complete = run(file);
    assert.equal(complete.status, 0);
    assert.match(complete.stdout, /not verified acceptance/);
    const blocked = manifest();
    first(blocked).status = 'BLOCKED';
    await writeFile(file, JSON.stringify(blocked));
    assert.equal(run(file).status, 2);
    await writeFile(file, '{never-print-me');
    const invalid = run(file);
    assert.equal(invalid.status, 1);
    assert.doesNotMatch(
      invalid.stdout + invalid.stderr,
      /never-print-me|SyntaxError|manifest.json/,
    );
    const unreadable = run(join(dir, 'never-print-me'));
    assert.equal(unreadable.status, 1);
    assert.doesNotMatch(unreadable.stderr, /never-print-me|ENOENT/);
    assert.equal(run().status, 1);
    assert.equal(run(file, 'extra').status, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
