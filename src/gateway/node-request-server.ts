import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  type ClientErrorFormat,
  clientErrorFormat,
  createClientErrorResponse,
} from './client-errors.ts';
import { isModelDiscoveryPath } from './model-discovery-path.ts';

/** Adapt an already-composed Fetch-style request boundary to a Node HTTP socket server. */
export function createNodeRequestServer(
  handle: (request: Request) => Promise<Response>,
  errorResponse?: () => Response,
): Server {
  return createServer(async (incoming, outgoing) => {
    const cancellation = new AbortController();
    const abort = () => cancellation.abort();
    const onClose = () => {
      if (!outgoing.writableFinished) abort();
    };
    incoming.once('aborted', abort);
    outgoing.once('close', onClose);
    let errorFormat: ClientErrorFormat = 'opengranter';
    let discoveryRequest = false;
    try {
      const path = incoming.url?.startsWith('/') ? incoming.url : '/';
      const pathname = new URL(`http://localhost${path}`).pathname;
      errorFormat = clientErrorFormat(pathname);
      discoveryRequest = isModelDiscoveryPath(pathname);
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        const name = incoming.rawHeaders[index];
        const value = incoming.rawHeaders[index + 1];
        if (name && value !== undefined) headers.append(name, value);
      }
      const method = incoming.method ?? 'GET';
      const request = new Request(`http://localhost${path}`, {
        method,
        headers,
        signal: cancellation.signal,
        ...(['GET', 'HEAD'].includes(method)
          ? {}
          : { body: Readable.toWeb(incoming), duplex: 'half' as const }),
      } as RequestInit & { duplex?: 'half' });
      const response = await handle(request);
      if (cancellation.signal.aborted || outgoing.destroyed) {
        await response.body?.cancel().catch(() => undefined);
        return;
      }
      outgoing.statusCode = response.status;
      response.headers.forEach((value, name) => {
        outgoing.setHeader(name, value);
      });
      if (discoveryRequest) outgoing.setHeader('cache-control', 'no-store');
      if (response.body) {
        await pipeline(Readable.fromWeb(response.body), outgoing);
      } else {
        outgoing.end();
      }
    } catch {
      if (outgoing.destroyed) {
        return;
      }
      if (outgoing.headersSent) {
        outgoing.destroy();
      } else {
        const response =
          errorResponse?.() ??
          createClientErrorResponse(500, 'internal_error', undefined, errorFormat);
        outgoing.statusCode = response.status;
        response.headers.forEach((value, name) => {
          outgoing.setHeader(name, value);
        });
        if (discoveryRequest) outgoing.setHeader('cache-control', 'no-store');
        outgoing.end(await response.text());
      }
    } finally {
      incoming.removeListener('aborted', abort);
      outgoing.removeListener('close', onClose);
    }
  });
}
