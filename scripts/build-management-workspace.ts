import { createHash } from 'node:crypto';
import { link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildManagementBrowser } from './build-management-browser.ts';

/** Fixed product entry, not a session grant or source-provenance assertion. */
export async function buildManagementWorkspace(root: string) {
  const entry = 'src/management/sso-catalog-entry.ts';
  const javascript = await buildManagementBrowser({ root, entry });
  return Object.freeze({
    profile: 'sso-workspace-v1' as const,
    entry,
    javascript,
    bytes: Buffer.byteLength(javascript, 'utf8'),
    sha256: createHash('sha256').update(javascript, 'utf8').digest('hex'),
  });
}

/** Publish a complete new artifact without replacing existing paths. */
export async function publishManagementWorkspace(root: string, output: string) {
  const { javascript, ...receipt } = await buildManagementWorkspace(root);
  const artifactPath = resolve(output);
  const staging = await mkdtemp(resolve(dirname(artifactPath), '.opengranter-workspace-'));
  try {
    const artifact = resolve(staging, 'app.js');
    await writeFile(artifact, javascript, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await link(artifact, artifactPath);
    return Object.freeze({ ...receipt, artifactPath });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output' || !args[1] || args[1].startsWith('--'))
      throw new Error();
    const receipt = await publishManagementWorkspace(process.cwd(), args[1]);
    process.stdout.write(JSON.stringify(receipt) + '\n');
  } catch {
    process.stderr.write(
      'Management workspace build failed; supply --output with a new artifact path.\n',
    );
    process.exitCode = 1;
  }
}
