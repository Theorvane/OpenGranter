import { realpath } from 'node:fs/promises';
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
  const root = await realpath(resolve(options.root));
  const source = await realpath(resolve(root, 'src/management'));
  // Reviewed content-free validators/encoders only; never permit whole server directories.
  const shared = new Set([
    resolve(root, 'src/export/csv.ts'),
    resolve(root, 'src/usage/record-parser.ts'),
    resolve(root, 'src/usage/record-usage.ts'),
    resolve(root, 'src/audit/attribution.ts'),
  ]);
  async function local(path: string, entryPoint = false) {
    const canonical = await realpath(path);
    const child = relative(source, canonical);
    if (!entryPoint && shared.has(canonical)) return canonical;
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
  const entry = await local(resolve(root, options.entry), true);
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
    const entry = process.argv[2];
    if (!entry || process.argv.length !== 3) throw new Error('Explicit entry required');
    process.stdout.write(await buildManagementBrowser({ root: process.cwd(), entry }));
  } catch {
    process.stderr.write(
      'Management browser build failed; supply a reviewed local TypeScript entry.\n',
    );
    process.exitCode = 1;
  }
}
