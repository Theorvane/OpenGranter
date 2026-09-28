import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Adapt an already-composed Fetch-style request boundary to a Node HTTP socket server. */
export function createNodeRequestServer(handle: (request: Request) => Promise<Response>): Server {
  return createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        const name = incoming.rawHeaders[index];
        const value = incoming.rawHeaders[index + 1];
        if (name && value) headers.append(name, value);
      }
      const path = incoming.url?.startsWith('/') ? incoming.url : '/';
      const method = incoming.method ?? 'GET';
      const request = new Request(`http://localhost${path}`, {
        method,
        headers,
        ...(['GET', 'HEAD'].includes(method)
          ? {}
          : { body: Readable.toWeb(incoming), duplex: 'half' as const }),
      } as RequestInit & { duplex?: 'half' });
      const response = await handle(request);
      outgoing.statusCode = response.status;
      response.headers.forEach((value, name) => {
        outgoing.setHeader(name, value);
      });
      if (response.body) {
        await pipeline(Readable.fromWeb(response.body), outgoing);
      } else {
        outgoing.end();
      }
    } catch {
      if (outgoing.headersSent) {
        outgoing.destroy();
      } else {
        outgoing.statusCode = 500;
        outgoing.setHeader('content-type', 'application/json');
        outgoing.end(JSON.stringify({ error: { code: 'internal_error' } }));
      }
    }
  });
}
