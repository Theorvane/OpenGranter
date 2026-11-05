import type { Server } from 'node:http';
import { parseStoredUsageRecord, parseUsageCursor } from '../usage/history.ts';
import { type ClientErrorCode, createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import type { createPostgresSsoUsageHistory } from './postgres-sso-usage-history.ts';

export interface SsoUsageHistoryHttpPorts {
  readonly newRequestId: () => string;
  /** Trusted fresh-authenticated reader with mandatory awaited durable SSO audit. */
  readonly usage: ReturnType<typeof createPostgresSsoUsageHistory>;
}
function noStore(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}
function failure(status: number, code: ClientErrorCode, requestId?: string): Response {
  const response = noStore(createClientErrorResponse(status, code, requestId));
  if (status === 401) response.headers.set('www-authenticate', 'Bearer');
  return response;
}

/** Bearer-only read/export API. No cookie, session, socket binding or automatic mount. */
export function createSsoUsageHistoryHandler(
  ports: SsoUsageHistoryHttpPorts,
): (request: Request) => Promise<Response> {
  const { newRequestId } = ports;
  const { read } = ports.usage;
  return async (request) => {
    let requestId: string | undefined;
    try {
      const url = new URL(request.url);
      if (request.method !== 'GET' || url.pathname !== '/management/v1/usage')
        return failure(404, 'not_found');
      const generatedId = newRequestId();
      if (
        typeof generatedId !== 'string' ||
        generatedId.length > 256 ||
        !/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(generatedId)
      )
        return failure(503, 'internal_error');
      requestId = generatedId;
      const length = request.headers.get('content-length');
      if (
        request.signal.aborted ||
        url.search.length > 8192 ||
        request.body !== null ||
        request.headers.has('transfer-encoding') ||
        (length !== null && length !== '0')
      )
        return failure(400, 'invalid_request', requestId);
      const token = /^Bearer ([^\s,]+)$/iu.exec(request.headers.get('authorization') ?? '')?.[1];
      // Empty/malformed Bearer reaches the service, preserving denial auditing.
      const result = await read(token ?? '', requestId, url.search);
      if (request.signal.aborted) return failure(400, 'invalid_request', requestId);
      switch (result.state) {
        case 'unauthenticated':
          return failure(401, 'unauthorized', requestId);
        case 'forbidden':
          return failure(403, 'forbidden', requestId);
        case 'invalid_query':
          return failure(400, 'invalid_request', requestId);
        case 'unavailable':
          return failure(503, 'usage_unavailable', requestId);
        case 'audit_unavailable':
          return failure(503, 'audit_unavailable', requestId);
        case 'ready': {
          if (
            !token ||
            typeof result.hasMore !== 'boolean' ||
            (result.hasMore ? typeof result.nextCursor !== 'string' : result.nextCursor !== null)
          )
            return failure(503, 'internal_error', requestId);
          const headers = new Headers({
            'x-request-id': requestId,
            'x-usage-has-more': String(result.hasMore),
          });
          if (result.nextCursor !== null) {
            parseUsageCursor(result.nextCursor);
            headers.set('x-usage-next-cursor', result.nextCursor);
          }
          if (result.format === 'json') {
            if (!Array.isArray(result.data) || result.data.length > 100)
              return failure(503, 'internal_error', requestId);
            return noStore(
              Response.json(
                {
                  object: 'list',
                  data: result.data.map(parseStoredUsageRecord),
                  has_more: result.hasMore,
                  next_cursor: result.nextCursor,
                },
                { headers },
              ),
            );
          }
          if (result.format !== 'csv' || typeof result.csv !== 'string')
            return failure(503, 'internal_error', requestId);
          headers.set('content-type', 'text/csv; charset=utf-8');
          headers.set('content-disposition', 'attachment; filename="usage.csv"');
          return noStore(new Response(result.csv, { headers }));
        }
        default:
          return failure(503, 'internal_error', requestId);
      }
    } catch {
      return failure(503, 'internal_error', requestId);
    }
  };
}

/** Returns an unbound server; caller owns TLS, migrations and lifecycle. */
export function createSsoUsageHistoryServer(ports: SsoUsageHistoryHttpPorts): Server {
  return createNodeRequestServer(createSsoUsageHistoryHandler(ports), () =>
    failure(503, 'internal_error'),
  );
}
