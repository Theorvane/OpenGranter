import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createManagementBrowserServer } from '../src/management/browser-http.ts';
import { buildManagementBrowser } from './build-management-browser.ts';

/** Development preview only. No gateway, identity, backend or provider is started.
 * Source root is trusted reviewed code, not a filesystem sandbox.
 */
export async function startManagementPreview(root: string, port: number) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Invalid preview port');
  }
  const javascript = await buildManagementBrowser({
    root,
    entry: 'src/management/sso-catalog-entry.ts',
  });
  const server = createManagementBrowserServer({
    javascript,
    application: async () =>
      new Response('Not found', {
        status: 404,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        },
      }),
  });
  const listening = once(server, 'listening');
  server.listen(port, '127.0.0.1');
  await listening;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const port = process.argv[3];
    if (
      process.argv.length !== 4 ||
      process.argv[2] !== '--port' ||
      port === undefined ||
      !/^(0|[1-9][0-9]{0,4})$/.test(port)
    ) {
      throw new Error('Invalid preview arguments');
    }
    const root = fileURLToPath(new URL('..', import.meta.url));
    const server = await startManagementPreview(root, Number(port));
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.closeAllConnections();
      server.close(() => {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
      });
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.stdout.write(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/management\n` +
        'Public signed-out shell only; no login, API or provider activation.\n',
    );
  } catch {
    process.stderr.write(
      'Management preview failed. Use --port <0-65535>; loopback public shell only.\n',
    );
    process.exitCode = 1;
  }
}
