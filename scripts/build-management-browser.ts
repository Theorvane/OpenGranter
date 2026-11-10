import { link, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export interface ManagementBrowserBuildOptions {
  readonly root: string;
  readonly entry: string;
}

/** Builds reviewed public source, not a secret scanner or untrusted-code sandbox.
 * No environment injection, disk output, listener or session authority is added.
 */
export async function buildManagementBrowser(
  options: ManagementBrowserBuildOptions,
): Promise<string> {
  const root = resolve(options.root);
  const source = await realpath(resolve(root, 'src/management'));
  async function local(path: string) {
    const canonical = await realpath(path);
    const child = relative(source, canonical);
    if (
      !child ||
      child === '..' ||
      child.startsWith('..' + sep) ||
      isAbsolute(child) ||
      !canonical.endsWith('.ts')
    ) {
      throw new Error('Management build requires local TypeScript sources');
    }
    return canonical;
  }
  const entry = await local(resolve(root, options.entry));
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    outfile: 'app.js',
    write: false,
    sourcemap: false,
    legalComments: 'none',
    metafile: true,
    logLevel: 'silent',
    plugins: [
      {
        name: 'management-public-source-only',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, async (args) => {
            if (args.kind === 'entry-point') return { path: entry };
            if (!args.path.startsWith('./') && !args.path.startsWith('../')) {
              throw new Error('Management build forbids external dependencies');
            }
            return { path: await local(resolve(dirname(args.importer), args.path)) };
          });
        },
      },
    ],
  });
  const output = result.outputFiles[0];
  if (
    result.outputFiles.length !== 1 ||
    !output ||
    Object.values(result.metafile.outputs).some((file) => file.imports.length > 0)
  ) {
    throw new Error('Management build requires one self-contained module');
  }
  return output.text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const entry = args[0];
    const output = args[2];
    if (!entry || (args.length !== 1 && (args.length !== 3 || args[1] !== '--output' || !output)))
      throw new Error('Explicit entry and optional output required');
    const javascript = await buildManagementBrowser({ root: process.cwd(), entry });
    if (output === undefined) {
      process.stdout.write(javascript);
    } else {
      // A new versioned artifact is published only after a complete build/write.
      // Hard-link creation is atomic and cannot replace files or symlinks.
      const destination = resolve(output);
      const staging = await mkdtemp(resolve(dirname(destination), '.opengranter-build-'));
      try {
        const artifact = resolve(staging, 'app.js');
        await writeFile(artifact, javascript, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await link(artifact, destination);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
  } catch {
    process.stderr.write(
      'Management browser build failed; supply a reviewed local TypeScript entry.\n',
    );
    process.exitCode = 1;
  }
}
