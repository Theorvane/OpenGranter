import { createServer, type Server, validateHeaderValue } from 'node:http';
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
    let managementRequest = false;
    try {
      const path = incoming.url?.startsWith('/') ? incoming.url : '/';
      const pathname = new URL(`http://localhost${path}`).pathname;
      errorFormat = clientErrorFormat(pathname);
      discoveryRequest = isModelDiscoveryPath(pathname);
      managementRequest = pathname === '/management' || pathname.startsWith('/management/');
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
          : {
              body: Readable.toWeb(
                managementRequest
                  ? Readable.from(incoming.iterator({ destroyOnReturn: false }))
                  : incoming,
              ),
              duplex: 'half' as const,
            }),
      } as RequestInit & { duplex?: 'half' });
      const response = await handle(request);
      // A rejected management upload must not destroy its response socket.
      // Do not drain unbounded input or reuse a connection with unread bytes.
      if (managementRequest && !incoming.readableEnded) outgoing.shouldKeepAlive = false;
      if (cancellation.signal.aborted || outgoing.destroyed) {
        await response.body?.cancel().catch(() => undefined);
        return;
      }
      // Validate the complete metadata before staging any part of a normal response.
      if (response.status < 200 || response.status > 599) throw new Error('Invalid response');
      response.headers.forEach((value, name) => {
        validateHeaderValue(name, value);
      });
      outgoing.statusCode = response.status;
      response.headers.forEach((value, name) => {
        outgoing.setHeader(name, value);
      });
      if (discoveryRequest || managementRequest) outgoing.setHeader('cache-control', 'no-store');
      if (managementRequest) outgoing.setHeader('x-content-type-options', 'nosniff');
      if (response.body) {
        await pipeline(Readable.fromWeb(response.body), outgoing);
      } else {
        outgoing.end();
      }
    } catch {
      if (managementRequest && !incoming.readableEnded) outgoing.shouldKeepAlive = false;
      if (outgoing.destroyed) {
        return;
      }
      if (outgoing.headersSent) {
        outgoing.destroy();
      } else {
        // Stream adaptation can fail after headers were staged but before commitment.
        // None of that failed response (especially cookies/framing) belongs to the fallback.
        for (const name of outgoing.getHeaderNames()) outgoing.removeHeader(name);
        let response: Response;
        let body: string;
        try {
          response =
            errorResponse?.() ??
            createClientErrorResponse(500, 'internal_error', undefined, errorFormat);
          // Prepare the whole fallback before committing any custom status, headers or bytes.
          // A broken factory/body must not reject the async Node request listener.
          if (response.status < 200 || response.status > 599) throw new Error('Invalid fallback');
          response.headers.forEach((value, name) => {
            validateHeaderValue(name, value);
          });
          body = await response.text();
        } catch {
          response = createClientErrorResponse(500, 'internal_error', undefined, errorFormat);
          body = await response.text();
        }
        if (outgoing.destroyed) return;
        outgoing.statusCode = response.status;
        response.headers.forEach((value, name) => {
          outgoing.setHeader(name, value);
        });
        if (discoveryRequest || managementRequest) outgoing.setHeader('cache-control', 'no-store');
        if (managementRequest) outgoing.setHeader('x-content-type-options', 'nosniff');
        outgoing.end(body);
      }
    } finally {
      incoming.removeListener('aborted', abort);
      outgoing.removeListener('close', onClose);
    }
  });
}
