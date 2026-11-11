import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  buildManagementWorkspace,
  publishManagementWorkspace,
} from '../scripts/build-management-workspace.ts';

test('actual signed-out workspace profile is deterministic and hashes exact artifact bytes', async () => {
  const result = await buildManagementWorkspace(resolve('.'));
  assert.equal(result.entry, 'src/management/sso-catalog-entry.ts');
  assert.equal(result.profile, 'sso-workspace-v1');
  assert.equal(result.bytes, Buffer.byteLength(result.javascript));
  assert.equal(result.sha256, createHash('sha256').update(result.javascript).digest('hex'));
  assert.deepEqual(await buildManagementWorkspace(resolve('.')), result);
  assert.match(result.javascript, /mountSsoUsageWorkspace/);
  assert.doesNotMatch(result.javascript, /sourceMappingURL|process\.env|node:fs/);
});

test('publishes exact bytes and receipt without replacing existing files or symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-workspace-profile-'));
  try {
    const output = join(directory, 'workspace.js');
    const result = await publishManagementWorkspace(resolve('.'), output);
    const bytes = await readFile(output);
    assert.equal(result.artifactPath, output);
    assert.equal(result.bytes, bytes.length);
    assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
    await assert.rejects(publishManagementWorkspace(resolve('.'), output));
    assert.deepEqual(await readFile(output), bytes);
    const target = join(directory, 'existing');
    await writeFile(target, 'preserve');
    const link = join(directory, 'link.js');
    await symlink(target, link);
    await assert.rejects(publishManagementWorkspace(resolve('.'), link));
    assert.equal(await readFile(target, 'utf8'), 'preserve');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI emits a pin-ready receipt and rejects missing or extra arguments without publishing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-workspace-cli-'));
  try {
    const output = join(directory, 'app.js');
    const script = resolve('scripts/build-management-workspace.ts');
    const run = (args: readonly string[]) =>
      spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
        encoding: 'utf8',
      });
    for (const args of [[], ['--output'], ['--output', output, '--extra'], ['--entry', output]]) {
      const result = run(args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(
        result.stderr,
        'Management workspace build failed; supply --output with a new artifact path.\n',
      );
      await assert.rejects(readFile(output));
    }
    const result = run(['--output', output]);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.artifactPath, output);
    assert.equal(
      receipt.sha256,
      createHash('sha256')
        .update(await readFile(output))
        .digest('hex'),
    );
    const duplicate = run(['--output', output]);
    assert.equal(duplicate.status, 1);
    assert.equal(duplicate.stdout, '');
    assert.doesNotMatch(duplicate.stderr, /EEXIST|\.js|\/tmp/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
